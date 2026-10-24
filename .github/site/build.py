"""Build a landing + docs site for GitHub Pages from README.md and docs/*.md.

Usage: python3 .github/site/build.py <out_dir>   (run from the repo root)
Config: .github/site/site.toml. Owner/repo come from GITHUB_REPOSITORY,
default branch from SITE_BRANCH (both set by the workflow).
"""
import datetime
import html
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tomllib

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from md import Renderer, plain  # noqa: E402
from page import UI, landing_body, shell  # noqa: E402
import check  # noqa: E402

ROOT = pathlib.Path.cwd()
IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif"}


def git(*args):
    try:
        r = subprocess.run(["git", *args], capture_output=True, text=True)
    except OSError:
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def sections(text):
    """Split markdown into {h2 title lower: body} outside code fences."""
    out, cur, fence = {}, None, None
    for line in text.splitlines():
        s = line.strip()
        if s.startswith(("```", "~~~")):
            fence = None if fence and s.startswith(fence) else (fence or s[:3])
        if fence is None and line.startswith("## "):
            cur = line[3:].strip().lower()
            out[cur] = []
            continue
        if cur is not None and not (fence is None and line.startswith("# ")):
            out[cur].append(line)
    return {k: "\n".join(v).strip() for k, v in out.items()}


def first_para(text, limit=155):
    for block in text.split("\n\n"):
        b = block.strip()
        if b and not b.startswith(("#", "```", "<", "|", ">", "!", "[!")):
            t = " ".join(plain(b).split())
            return t if len(t) <= limit else t[:limit - 1].rsplit(" ", 1)[0] + "…"
    return ""


def main(out):
    cfg = tomllib.loads((HERE / "site.toml").read_text(encoding="utf-8"))
    owner, _, repo = os.environ.get("GITHUB_REPOSITORY", cfg.get("repository", "")).partition("/")
    if not repo:
        sys.exit("set GITHUB_REPOSITORY=owner/repo or `repository` in site.toml")
    branch = os.environ.get("SITE_BRANCH") or cfg.get("branch", "main")
    lang = cfg.get("lang", "en")
    ui = UI[lang]
    base = f"https://{owner.lower()}.github.io/{repo}/"
    gh = f"https://github.com/{owner}/{repo}"
    site = dict(cfg=cfg, ui=ui, lang=lang, base=base, gh=gh, name=cfg["name"], branch=branch,
                version=git("describe", "--tags", "--abbrev=0") or cfg.get("version", ""))

    readme = cfg.get("readme", "README.md")
    srcs = {readme: "docs/"}
    extra = list(cfg.get("pages", []))
    ddir = cfg.get("docs_dir", "docs")
    if ddir and (ROOT / ddir).is_dir():
        extra += sorted(str(p.relative_to(ROOT)) for p in (ROOT / ddir).glob("*.md"))
    for p in extra:
        pp = pathlib.PurePosixPath(p)
        slug = pp.parent.name if pp.name.lower() == "readme.md" else pp.stem.lower()
        srcs[p] = f"docs/{slug}/"

    def resolver(src, depth, landing=False):
        prefix = "../" * depth

        def resolve(url):
            if url.startswith(("http:", "https:", "mailto:", "//", "data:")):
                return url
            if url.startswith("#"):
                return f"{prefix}docs/{url}" if landing else url
            path, _, anchor = url.partition("#")
            frag = f"#{anchor}" if anchor else ""
            target = os.path.normpath(os.path.join(os.path.dirname(src), path)).replace("\\", "/")
            if target.startswith(".."):
                return gh
            for cand in (target, f"{target}/README.md", f"{target}/readme.md"):
                if cand in srcs:
                    return prefix + srcs[cand] + frag
            if pathlib.PurePosixPath(target).suffix.lower() in IMG_EXT:
                return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{target}"
            kind = "tree" if (ROOT / target).is_dir() else "blob"
            return f"{gh}/{kind}/{branch}/{target}{frag}"
        return resolve

    out = pathlib.Path(out)
    shutil.rmtree(out, ignore_errors=True)
    (out / "assets").mkdir(parents=True)
    shutil.copy(HERE / "site.css", out / "assets/site.css")
    og = cfg.get("og_image", "")
    if og and (ROOT / og).is_file():
        shutil.copy(ROOT / og, out / f"assets/og{pathlib.Path(og).suffix}")
        site["og"] = f"{base}assets/og{pathlib.Path(og).suffix}"
    else:
        site["og"] = f"https://opengraph.githubassets.com/1/{owner}/{repo}"

    today = datetime.date.today().isoformat()
    pages, llms_full = [], []
    for src, path in srcs.items():
        text = (ROOT / src).read_text(encoding="utf-8")
        r = Renderer(resolver(src, path.count("/")))
        body = r.render(text)
        h1 = next((t for lvl, t, _ in r.headings if lvl == 1), pathlib.Path(src).stem)
        title = f"{ui['docs']} — {site['name']}" if src == readme else f"{h1} — {site['name']}"
        pages.append(dict(src=src, path=path, h1=h1, title=title, body=body, toc=r.headings,
                          desc=first_para(text) or cfg["description"],
                          lastmod=(git("log", "-1", "--format=%cs", "--", src) or today)))
        llms_full.append(f"# Source: {gh}/blob/{branch}/{src}\n\n{text.strip()}\n")

    readme_text = (ROOT / readme).read_text(encoding="utf-8")
    secs = sections(readme_text)
    landing_parts = []
    for name in cfg.get("landing_sections", []):
        if name.lower() not in secs:
            sys.exit(f"landing section '{name}' not found in {readme}")
        r = Renderer(resolver(readme, 0, landing=True))
        landing_parts.append((name, r.render(secs[name.lower()])))
    home = dict(src=readme, path="", title=cfg.get("title", site["name"]), desc=cfg["description"],
                lastmod=pages[0]["lastmod"])
    write(out, "", shell(site, home, landing_body(site, landing_parts, pages), pages, kind="home"))
    for p in pages:
        write(out, p["path"], shell(site, p, None, pages, kind="doc"))
    nf = dict(path="404.html", title=f"{ui['notfound']} — {site['name']}", desc=cfg["description"])
    (out / "404.html").write_text(shell(site, nf, None, pages, kind="404"), encoding="utf-8")

    urls = [("", home["lastmod"])] + [(p["path"], p["lastmod"]) for p in pages]
    (out / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"<url><loc>{html.escape(base + u)}</loc><lastmod>{d}</lastmod></url>\n"
                  for u, d in urls) + "</urlset>\n", encoding="utf-8")
    (out / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {base}sitemap.xml\n",
                                    encoding="utf-8")
    llms = [f"# {site['name']}\n", f"> {cfg['description']}\n",
            f"Source code: {gh}", f"License: {cfg.get('license', 'MIT')}\n"]
    for f in cfg.get("features", []):
        llms.append(f"- {f}")
    llms.append(f"\n## {ui['docs']}\n")
    llms += [f"- [{p['h1']}]({base}{p['path']}): {p['desc']}" for p in pages]
    for q in cfg.get("faq", []):
        llms.append(f"\n### {q['q']}\n\n{q['a']}")
    llms.append(f"\n## Optional\n\n- [Full text of all docs]({base}llms-full.txt)\n")
    (out / "llms.txt").write_text("\n".join(llms), encoding="utf-8")
    (out / "llms-full.txt").write_text("\n\n".join(llms_full), encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    errors = check.run(out, base)
    if errors:
        sys.exit("site check failed:\n" + "\n".join(errors))
    print(f"built {len(urls)} pages into {out} for {base}")


def write(out, path, content):
    d = out / path
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.html").write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
