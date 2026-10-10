#!/usr/bin/env bash
# Build the five Desktop Extension bundles into dist-mcpb/.
# This is the only build entry point, locally and in CI. npm and the mcpb CLI
# run inside node:24.21.0-slim as the current user; nothing is installed on the host.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

IMAGE="node:24.21.0-slim"
MCPB_CLI="@anthropic-ai/mcpb@2.1.2"
OUT="dist-mcpb"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/yandex-mcp-mcpb-npm"
mkdir -p "$CACHE"
rm -rf "$OUT"
mkdir -p "$OUT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat >"$WORK/list-tools.mjs" <<'EOF'
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn(process.execPath, ['src/index.mjs'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});
let stdout = '';
let stderr = '';
let done = false;
child.stdout.on('data', (chunk) => {
  stdout += chunk;
  tryFinish();
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

function send(id, method, params) {
  const msg = { jsonrpc: '2.0', method, params };
  if (id !== null) msg.id = id;
  child.stdin.write(`${JSON.stringify(msg)}\n`);
}

send(1, 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'build-mcpb', version: '1' },
});
send(null, 'notifications/initialized', undefined);
send(2, 'tools/list', {});

const timer = setTimeout(() => {
  if (done) return;
  done = true;
  console.error(`timeout waiting for tools/list; stderr: ${stderr}`);
  child.kill('SIGKILL');
  process.exit(1);
}, 30000);

function tryFinish() {
  if (done) return;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== 2) continue;
    done = true;
    clearTimeout(timer);
    if (msg.error) {
      console.error(JSON.stringify(msg.error));
      console.error(stderr);
      child.kill('SIGKILL');
      process.exit(1);
    }
    const tools = (msg.result?.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
    }));
    writeFileSync('tools-list.json', `${JSON.stringify(tools)}\n`);
    child.kill('SIGKILL');
    process.exit(0);
  }
}

child.on('exit', (code) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  console.error(`server exited ${code} before tools/list; stderr: ${stderr}`);
  process.exit(code || 1);
});
EOF

cat >"$WORK/finish-manifest.py" <<'PY'
import json
import sys

stage, package_json, source_manifest = sys.argv[1:]
version = json.load(open(package_json, encoding="utf-8"))["version"]
manifest = json.load(open(source_manifest, encoding="utf-8"))
if "version" in manifest:
    sys.exit(f"{source_manifest}: version is substituted from package.json, do not store it")
live = json.load(open(f"{stage}/tools-list.json", encoding="utf-8"))
declared = [item.get("name") for item in manifest.get("tools") or []]
live_names = [item["name"] for item in live]
if not declared:
    sys.exit(f"{source_manifest}: tools must list every tool name")
if set(declared) != set(live_names) or len(declared) != len(live_names):
    missing = sorted(set(live_names) - set(declared))
    extra = sorted(set(declared) - set(live_names))
    sys.exit(f"{source_manifest}: tool names differ; missing {missing}; extra {extra}")
manifest["version"] = version
manifest["tools"] = [{"name": item["name"], "description": item["description"]} for item in live]
with open(f"{stage}/manifest.json", "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
PY

cat >"$WORK/mcpbignore" <<'EOF'
**/.git/**
**/__pycache__/**
**/.env
**/.env.*
**/*.map
**/*.ts
**/*.tsx
**/*.mts
**/*.cts
**/test/**
**/tests/**
**/__tests__/
tools-list.json
EOF

cat >"$WORK/pin-from-lock.py" <<'PY'
# The bundle must carry the dependency versions bun.lock pins, not whatever
# the package.json ranges resolve to on the day of the build. Rewrite the
# staged package.json with exact direct versions plus npm overrides for every
# locked package, or check that node_modules matches the lock after install.
import json
import os
import re
import sys

mode, lock_path, stage = sys.argv[1:]
text = open(lock_path, encoding="utf-8").read()
lock = json.loads(re.sub(r",(\s*[}\]])", r"\1", text))
pinned = {}
for name, entry in lock["packages"].items():
    spec = entry[0]
    pkg_name, _, version = spec.rpartition("@")
    if pkg_name != name or not version or version.startswith("workspace:"):
        continue
    pinned[name] = version

manifest_path = f"{stage}/package.json"
if mode == "pin":
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    deps = manifest.get("dependencies") or {}
    missing = sorted(set(deps) - set(pinned))
    if missing:
        sys.exit(f"bun.lock has no entry for {missing}")
    manifest["dependencies"] = {name: pinned[name] for name in deps}
    manifest["overrides"] = {n: v for n, v in sorted(pinned.items()) if not n.startswith("@biomejs/")}
    manifest.pop("devDependencies", None)
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
elif mode == "check":
    bad = []
    root = f"{stage}/node_modules"
    for dirpath, _dirs, files in os.walk(root):
        if "package.json" not in files:
            continue
        parts = dirpath.split(os.sep)
        if len(parts) >= 2 and parts[-2] == "node_modules":
            name = parts[-1]
        elif len(parts) >= 3 and parts[-3] == "node_modules" and parts[-2].startswith("@"):
            name = f"{parts[-2]}/{parts[-1]}"
        else:
            continue
        if name.startswith("."):
            continue
        version = json.load(open(f"{dirpath}/package.json", encoding="utf-8")).get("version")
        if pinned.get(name) != version:
            bad.append(f"{name}@{version} (lock {pinned.get(name)})")
    if bad:
        sys.exit("node_modules differs from bun.lock: " + ", ".join(sorted(set(bad))))
else:
    sys.exit(f"unknown mode {mode}")
PY

uid="$(id -u)"
gid="$(id -g)"

for name in search wordstat webmaster metrika direct; do
  pkg="yandex-${name}-mcp"
  stage="$WORK/$pkg"
  mkdir -p "$stage/src"
  cp "packages/$pkg/src/"*.mjs "$stage/src/"
  cp "packages/$pkg/package.json" "$stage/package.json"
  cp "mcpb/$pkg/manifest.json" "$stage/manifest.json"
  cp "$WORK/mcpbignore" "$stage/.mcpbignore"

  python3 "$WORK/pin-from-lock.py" pin bun.lock "$stage"
  docker run --rm -u "$uid:$gid" -e HOME=/tmp -e npm_config_cache=/npm \
    -v "$CACHE":/npm -v "$stage":/app -w /app "$IMAGE" \
    npm install --omit=dev --ignore-scripts --no-audit --no-fund
  python3 "$WORK/pin-from-lock.py" check bun.lock "$stage"
  cp "packages/$pkg/package.json" "$stage/package.json"

  find "$stage/node_modules" -depth -type d \( -name test -o -name tests -o -name __tests__ -o -name __pycache__ -o -name .git \) -exec rm -rf {} +
  find "$stage/node_modules" -type f \( -name '*.map' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' -o -name '.env' -o -name '.env.*' \) -delete
  rm -f "$stage/package-lock.json" "$stage/node_modules/.package-lock.json"

  docker run --rm --network none -u "$uid:$gid" -e HOME=/tmp \
    -e YANDEX_SEARCH_API_KEY=smoke -e YANDEX_FOLDER_ID=smoke \
    -e WORDSTAT_API_KEY=smoke -e WORDSTAT_FOLDER_ID=smoke \
    -e YANDEX_WEBMASTER_TOKEN=smoke -e YANDEX_METRIKA_TOKEN=smoke \
    -e YANDEX_DIRECT_TOKEN=smoke -e YANDEX_DIRECT_CLIENT_LOGIN= -e YANDEX_DIRECT_SANDBOX=false \
    -v "$stage":/app -w /app -v "$WORK/list-tools.mjs":/list-tools.mjs:ro \
    "$IMAGE" node /list-tools.mjs

  python3 "$WORK/finish-manifest.py" "$stage" "packages/$pkg/package.json" "mcpb/$pkg/manifest.json"
  rm -f "$stage/tools-list.json"

  version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "packages/$pkg/package.json")"
  docker run --rm -u "$uid:$gid" -e HOME=/tmp -e npm_config_cache=/npm \
    -v "$CACHE":/npm -v "$stage":/app -v "$PWD/$OUT":/out -w /app "$IMAGE" \
    npx -y "$MCPB_CLI" pack /app "/out/${pkg}-${version}.mcpb"
  echo "built $OUT/${pkg}-${version}.mcpb"
done
