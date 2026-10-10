#!/usr/bin/env python3
# ruff: noqa
"""Machine checks for the MCP promotion milestone (stdlib only, Python 3.8+).

Subcommands:
  tools   start a stdio MCP server, list its tools, check descriptions and
          annotations; optionally dump the list to a JSON file
  readme  check README client blocks, example prompts and the install path
  bundle  check a built .mcpb file against the manifest rules and a tools dump
  ci      check that a release workflow builds and uploads .mcpb assets
  e2e     start an extracted bundle from its mcp_config in Docker, check its tools
  surface compare tool names and input schemas of two tools dumps

Every subcommand exits 0 only when every check passed, and prints one line per
failure otherwise.
"""

import argparse
import json
import re
import select
import shlex
import subprocess
import sys
import time
import zipfile

CLIENTS = {
    "claude-code": {"title": "Claude Code", "key": "mcpServers"},
    "claude-desktop": {"title": "Claude Desktop", "key": "mcpServers"},
    "cursor": {"title": "Cursor", "key": "mcpServers"},
    "windsurf": {"title": "Windsurf", "key": "mcpServers"},
    "zed": {"title": "Zed", "key": "context_servers"},
}


def fail(problems):
    for p in problems:
        print("FAIL: " + p)
    if problems:
        return 1
    print("OK")
    return 0


# ---------------------------------------------------------------- tools
class Stdio:
    def __init__(self, cmd, timeout):
        self.timeout = timeout
        self.proc = subprocess.Popen(
            cmd, shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        self.buf = b""
        self.next_id = 1

    def send(self, obj):
        self.proc.stdin.write((json.dumps(obj) + "\n").encode())
        self.proc.stdin.flush()

    def request(self, method, params):
        rid = self.next_id
        self.next_id += 1
        self.send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            while b"\n" in self.buf:
                line, self.buf = self.buf.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue  # a server may log to stdout before speaking; skip it
                if isinstance(msg, dict) and msg.get("id") == rid and "method" not in msg:
                    if "error" in msg:
                        raise RuntimeError("%s -> error %s" % (method, msg["error"]))
                    return msg.get("result", {})
            ready, _, _ = select.select([self.proc.stdout], [], [], 1.0)
            if ready:
                chunk = (
                    self.proc.stdout.read1(65536)
                    if hasattr(self.proc.stdout, "read1")
                    else self.proc.stdout.readline()
                )
                if not chunk:
                    err = self.proc.stderr.read().decode("utf-8", "replace")[-2000:]
                    raise RuntimeError(
                        "server closed stdout during %s; stderr tail: %s" % (method, err)
                    )
                self.buf += chunk
        raise RuntimeError("timeout after %ss waiting for %s" % (self.timeout, method))

    def close(self):
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()


def list_tools(cmd, timeout):
    s = Stdio(cmd, timeout)
    try:
        s.request(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "promo-check", "version": "1"},
            },
        )
        s.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        tools, cursor = [], None
        for _ in range(100):
            params = {"cursor": cursor} if cursor else {}
            res = s.request("tools/list", params)
            tools.extend(res.get("tools", []))
            cursor = res.get("nextCursor")
            if not cursor:
                break
        return tools
    finally:
        s.close()


def check_tools(tools, min_words, phrase, max_tools):
    problems = []
    if not tools:
        problems.append("server listed no tools")
    if max_tools and len(tools) > max_tools:
        problems.append("%d tools listed, limit is %d" % (len(tools), max_tools))
    for t in tools:
        name = t.get("name", "?")
        desc = t.get("description") or ""
        words = len(desc.split())
        if words < min_words:
            problems.append("%s: description has %d words, needs >= %d" % (name, words, min_words))
        if phrase and phrase.lower() not in desc.lower():
            problems.append("%s: description lacks %r" % (name, phrase))
        ann = t.get("annotations")
        if not isinstance(ann, dict):
            problems.append("%s: no annotations object" % name)
            continue
        ro = ann.get("readOnlyHint")
        de = ann.get("destructiveHint")
        if ro is not None and not isinstance(ro, bool):
            problems.append("%s: readOnlyHint is not a boolean" % name)
        if de is not None and not isinstance(de, bool):
            problems.append("%s: destructiveHint is not a boolean" % name)
        if ro is not True and not isinstance(de, bool):
            problems.append("%s: not readOnlyHint=true and no explicit destructiveHint" % name)
        if ro is True and de is True:
            problems.append("%s: readOnlyHint=true together with destructiveHint=true" % name)
    return problems


def cmd_tools(a):
    try:
        tools = list_tools(a.cmd, a.timeout)
    except Exception as e:  # report, do not trace back
        return fail(["could not list tools: %s" % e])
    if a.dump:
        with open(a.dump, "w", encoding="utf-8") as f:
            json.dump(tools, f, indent=1, ensure_ascii=False)
    print("tools listed: %d" % len(tools))
    return fail(check_tools(tools, a.min_words, a.phrase, a.max_tools))


# ---------------------------------------------------------------- readme
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
FENCE = re.compile(r"^(```+|~~~+)\s*([\w+-]*)")


def parse_sections(text):
    """Return [(level, title, [(lang, body), ...], [plain lines])]."""
    sections, cur = [], [0, "", [], []]
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        m = FENCE.match(line)
        if m:
            fence, lang = m.group(1), m.group(2).lower()
            body = []
            i += 1
            while i < len(lines) and not lines[i].startswith(fence):
                body.append(lines[i])
                i += 1
            cur[2].append((lang, "\n".join(body)))
            i += 1
            continue
        h = HEADING.match(line)
        if h:
            sections.append(tuple(cur))
            cur = [len(h.group(1)), h.group(2), [], []]
        else:
            cur[3].append(line)
        i += 1
    sections.append(tuple(cur))
    return sections


def section_with_children(sections, idx):
    level = sections[idx][0]
    blocks, lines = list(sections[idx][2]), list(sections[idx][3])
    for s in sections[idx + 1 :]:
        if s[0] <= level:
            break
        blocks.extend(s[2])
        lines.extend(s[3])
    return blocks, lines


def mentions(title, client):
    return CLIENTS[client]["title"].lower() in title.lower()


def check_readme(text, commands, examples_min, examples_max):
    problems = []
    sections = parse_sections(text)
    for client, info in CLIENTS.items():
        idxs = [
            i
            for i, s in enumerate(sections)
            if s[0]
            and mentions(s[1], client)
            and not any(mentions(s[1], o) for o in CLIENTS if o != client)
        ]
        if not idxs:
            problems.append("%s: no heading naming only this client" % info["title"])
            continue
        found, notes = False, []
        for i in idxs:
            for lang, body in section_with_children(sections, i)[0]:
                if lang not in ("json", "jsonc"):
                    continue
                try:
                    data = json.loads(body)
                except ValueError as e:
                    notes.append("JSON block does not parse: %s" % e)
                    continue
                servers = data.get(info["key"]) if isinstance(data, dict) else None
                if not isinstance(servers, dict) or not servers:
                    notes.append("JSON block has no non-empty %r object" % info["key"])
                    continue
                ok = True
                for sname, entry in servers.items():
                    cmd = entry.get("command") if isinstance(entry, dict) else None
                    args = entry.get("args", []) if isinstance(entry, dict) else None
                    if not isinstance(cmd, str) or not isinstance(args, list):
                        notes.append("server %r lacks command/args" % sname)
                        ok = False
                    elif commands and cmd not in commands:
                        notes.append(
                            "server %r runs %r, expected one of %s"
                            % (sname, cmd, ",".join(commands))
                        )
                        ok = False
                found = found or ok
        if not found:
            problems.append(
                "%s: no valid JSON config block under its heading (%s)"
                % (info["title"], "; ".join(notes) or "no json block")
            )
    ex = [
        i
        for i, s in enumerate(sections)
        if s[0] and re.search(r"\bexample (prompts|questions|requests)\b", s[1], re.I)
    ]
    if not ex:
        problems.append("no heading 'Example prompts' (or questions/requests)")
    else:
        lines = section_with_children(sections, ex[0])[1]
        items = [l for l in lines if re.match(r"^\s*([-*]|\d+\.)\s+\S", l)]
        if not examples_min <= len(items) <= examples_max:
            problems.append(
                "example prompts: %d list items, need %d..%d"
                % (len(items), examples_min, examples_max)
            )
    return problems


def cmd_readme(a):
    with open(a.readme, encoding="utf-8") as f:
        text = f.read()
    commands = [c for c in (a.commands or "").split(",") if c]
    return fail(check_readme(text, commands, a.examples_min, a.examples_max))


# ---------------------------------------------------------------- bundle
def cmd_bundle(a):
    problems = []
    try:
        z = zipfile.ZipFile(a.mcpb)
    except (OSError, zipfile.BadZipFile) as e:
        return fail(["%s: not a zip archive: %s" % (a.mcpb, e)])
    names = set(z.namelist())
    if "manifest.json" not in names:
        return fail(["manifest.json is not at the archive root"])
    try:
        m = json.loads(z.read("manifest.json").decode("utf-8"))
    except ValueError as e:
        return fail(["manifest.json does not parse: %s" % e])
    for key in ("manifest_version", "name", "version", "description", "author", "server"):
        if key not in m:
            problems.append("manifest lacks %r" % key)
    if a.version and m.get("version") != a.version:
        problems.append("manifest version %r != expected %r" % (m.get("version"), a.version))
    server = m.get("server") or {}
    if a.server_type and server.get("type") != a.server_type:
        problems.append("server.type %r != expected %r" % (server.get("type"), a.server_type))
    entry = server.get("entry_point")
    if entry and entry not in names and entry + ".exe" not in names:
        problems.append("entry_point %r is not in the archive" % entry)
    for p in a.require or []:
        if p not in names:
            problems.append("archive lacks %r" % p)
    if a.tools_dump:
        with open(a.tools_dump, encoding="utf-8") as f:
            live = {t["name"] for t in json.load(f)}
        declared = {t.get("name") for t in m.get("tools") or []}
        if m.get("tools_generated") is not True and declared != live:
            problems.append(
                "manifest tools differ from the server: missing %s, extra %s"
                % (sorted(live - declared), sorted(declared - live))
            )
        elif m.get("tools_generated") is True and not declared <= live:
            problems.append(
                "manifest declares tools the server lacks: %s" % sorted(declared - live)
            )
    user_cfg = m.get("user_config") or {}
    for k, v in user_cfg.items():
        if (
            isinstance(v, dict)
            and v.get("sensitive") is not True
            and re.search(r"token|secret|password|api.?key", k, re.I)
        ):
            problems.append("user_config %r looks like a secret but is not sensitive=true" % k)
    if a.require_privacy:
        pp = m.get("privacy_policies")
        if (
            not isinstance(pp, list)
            or not pp
            or not all(isinstance(u, str) and u.startswith("https://") for u in pp)
        ):
            problems.append("privacy_policies must be a non-empty list of https URLs")
    if a.extract:
        if problems:
            problems.append("not extracting a bundle that failed its checks")
        else:
            z.extractall(a.extract)
            if entry and server.get("type") == "binary":
                import os

                for n in (entry, entry + ".exe"):
                    path = os.path.join(a.extract, n)
                    if os.path.exists(path):
                        os.chmod(path, 0o755)
    print(
        "bundle %s: %d files, manifest %s %s"
        % (a.mcpb, len(names), m.get("name"), m.get("version"))
    )
    return fail(problems)


# ---------------------------------------------------------------- e2e
def substitute(value, dirname, user):
    def repl(m):
        key = m.group(1)
        if key == "__dirname":
            return dirname
        if key in ("HOME", "DESKTOP", "DOCUMENTS", "DOWNLOADS"):
            return "/tmp"
        if key in ("pathSeparator", "/"):
            return "/"
        if key.startswith("user_config."):
            k = key[len("user_config.") :]
            if k not in user:
                raise KeyError("no value for ${%s}: pass --set %s=..." % (key, k))
            return user[k]
        raise KeyError("unknown variable ${%s}" % key)

    return re.sub(r"\$\{([^}]+)\}", repl, value)


def cmd_e2e(a):
    """Start an extracted bundle the way a host would, from its mcp_config."""
    import os

    with open(os.path.join(a.dir, "manifest.json"), encoding="utf-8") as f:
        m = json.load(f)
    cfg = (m.get("server") or {}).get("mcp_config")
    if not isinstance(cfg, dict) or not cfg.get("command"):
        return fail(["server.mcp_config.command is missing"])
    user = {}
    for k, v in (m.get("user_config") or {}).items():
        if isinstance(v, dict) and "default" in v:
            d = v["default"]
            user[k] = json.dumps(d) if isinstance(d, bool) else str(d)
    for kv in a.set or []:
        k, _, v = kv.partition("=")
        user[k] = v
    try:
        command = substitute(cfg["command"], "/ext", user)
        args = [substitute(x, "/ext", user) for x in cfg.get("args", [])]
        env = {k: substitute(v, "/ext", user) for k, v in (cfg.get("env") or {}).items()}
    except KeyError as e:
        return fail([str(e)])
    if not command.startswith("/") and os.path.exists(os.path.join(a.dir, command)):
        command = "/ext/" + command
    docker = [
        "docker",
        "run",
        "--rm",
        "-i",
        "-u",
        "%d:%d" % (os.getuid(), os.getgid()),
        "-e",
        "HOME=/tmp",
        "-v",
        "%s:/ext" % os.path.abspath(a.dir),
        "-w",
        "/ext",
    ]
    if not a.network:
        docker += ["--network", "none"]
    for k, v in env.items():
        docker += ["-e", "%s=%s" % (k, v)]
    for e in a.env or []:
        docker += ["-e", e]
    docker += [a.image, command] + args
    line = " ".join(shlex.quote(x) for x in docker)
    print("e2e: " + line)
    try:
        tools = list_tools(line, a.timeout)
    except Exception as e:
        return fail(["bundle server did not list tools: %s" % e])
    problems = check_tools(tools, a.min_words, a.phrase, 0)
    live = {t.get("name") for t in tools}
    declared = {t.get("name") for t in m.get("tools") or []}
    if m.get("tools_generated") is True:
        if not declared <= live:
            problems.append(
                "manifest declares tools the server lacks: %s" % sorted(declared - live)
            )
    elif declared != live:
        problems.append(
            "manifest tools differ from the running bundle: missing %s, extra %s"
            % (sorted(live - declared), sorted(declared - live))
        )
    print("e2e: bundle listed %d tools, manifest declares %d" % (len(live), len(declared)))
    return fail(problems)


# ---------------------------------------------------------------- surface
def cmd_surface(a):
    """Tool names and input schemas must be unchanged between two dumps."""

    def load(path):
        with open(path, encoding="utf-8") as f:
            return {
                t["name"]: json.dumps(t.get("inputSchema"), sort_keys=True) for t in json.load(f)
            }

    before, after = load(a.before), load(a.after)
    problems = []
    if set(before) != set(after):
        problems.append(
            "tool names changed: removed %s, added %s"
            % (sorted(set(before) - set(after)), sorted(set(after) - set(before)))
        )
    for name in sorted(set(before) & set(after)):
        if before[name] != after[name]:
            problems.append("%s: inputSchema changed" % name)
    print("surface: %d tools before, %d after" % (len(before), len(after)))
    return fail(problems)


# ---------------------------------------------------------------- ci
def cmd_ci(a):
    problems = []
    try:
        with open(a.workflow, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        return fail(["%s: %s" % (a.workflow, e)])
    if not re.search(r"^on:[\s\S]*?tags:", text, re.M):
        problems.append("workflow is not triggered by tags")
    if a.build_marker and a.build_marker not in text:
        problems.append("workflow never runs %r" % a.build_marker)
    if not re.search(r"\.mcpb\b", text):
        problems.append("workflow never mentions a .mcpb file")
    if not re.search(r"gh release upload|action-gh-release|extra_files|upload-release-asset", text):
        problems.append("workflow has no release-asset upload step")
    return fail(problems)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="sub")
    t = sub.add_parser("tools")
    t.add_argument("--cmd", required=True, help="shell command starting the stdio server")
    t.add_argument("--min-words", type=int, default=25)
    t.add_argument("--phrase", default="Use when")
    t.add_argument("--max-tools", type=int, default=0)
    t.add_argument("--timeout", type=int, default=120)
    t.add_argument("--dump")
    r = sub.add_parser("readme")
    r.add_argument("readme")
    r.add_argument("--commands", default="", help="comma-separated allowed launch commands")
    r.add_argument("--examples-min", type=int, default=3)
    r.add_argument("--examples-max", type=int, default=5)
    b = sub.add_parser("bundle")
    b.add_argument("mcpb")
    b.add_argument("--version")
    b.add_argument("--server-type")
    b.add_argument("--tools-dump")
    b.add_argument("--require", action="append")
    b.add_argument("--require-privacy", action="store_true")
    b.add_argument("--extract", help="extract the bundle here after its checks pass")
    c = sub.add_parser("ci")
    c.add_argument("workflow")
    c.add_argument("--build-marker", default="")
    e = sub.add_parser("e2e")
    e.add_argument("--dir", required=True, help="an extracted bundle")
    e.add_argument("--image", required=True)
    e.add_argument("--set", action="append", help="user_config value KEY=VALUE")
    e.add_argument("--env", action="append", help="extra container env KEY=VALUE")
    e.add_argument("--network", action="store_true", help="allow network (uv needs it)")
    e.add_argument("--min-words", type=int, default=25)
    e.add_argument("--phrase", default="Use when")
    e.add_argument("--timeout", type=int, default=600)
    v = sub.add_parser("surface")
    v.add_argument("--before", required=True)
    v.add_argument("--after", required=True)
    a = ap.parse_args()
    if a.sub == "tools":
        return cmd_tools(a)
    if a.sub == "readme":
        return cmd_readme(a)
    if a.sub == "bundle":
        return cmd_bundle(a)
    if a.sub == "ci":
        return cmd_ci(a)
    if a.sub == "e2e":
        return cmd_e2e(a)
    if a.sub == "surface":
        return cmd_surface(a)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
