"""HTML shell, landing body and JSON-LD for build.py."""
import html
import json

UI = {
    "en": dict(home="Home", docs="Documentation", source="GitHub", features="What it does",
               faq="FAQ", pages="Documentation pages", contents="Contents", start="Get started",
               read_docs="Read the docs", view_source="View on GitHub", notfound="Page not found",
               back="Back to the home page", edit="Edit on GitHub", license="License",
               generated="This site is generated from the repository README and docs.",
               skip="Skip to content", locale="en_US"),
    "ru": dict(home="Главная", docs="Документация", source="GitHub", features="Что умеет",
               faq="Вопросы и ответы", pages="Разделы документации", contents="Содержание",
               start="Начать", read_docs="Документация", view_source="Код на GitHub",
               notfound="Страница не найдена", back="На главную", edit="Править на GitHub",
               license="Лицензия", generated="Сайт собирается из README и docs репозитория.",
               skip="К содержимому", locale="ru_RU"),
}

e = html.escape


def app_ld(site):
    cfg = site["cfg"]
    app = {
        "@type": "SoftwareApplication", "@id": site["base"] + "#app", "name": site["name"],
        "description": cfg["description"], "url": site["base"],
        "applicationCategory": cfg.get("category", "DeveloperApplication"),
        "operatingSystem": cfg.get("os", "Linux, macOS, Windows"),
        "inLanguage": site["lang"], "keywords": ", ".join(cfg.get("keywords", [])),
        "license": cfg.get("license_url", "https://opensource.org/license/mit"),
        "downloadUrl": cfg.get("download_url", site["gh"] + "/releases"),
        "sameAs": [site["gh"]] + cfg.get("same_as", []),
        "author": {"@type": "Person", "name": cfg.get("author", site["gh"].split("/")[3]),
                   "url": "https://github.com/" + site["gh"].split("/")[3]},
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
    }
    if site["version"]:
        app["softwareVersion"] = site["version"].lstrip("v")
    if cfg.get("programming_language"):
        app["programmingLanguage"] = cfg["programming_language"]
    return app


def json_ld(site, page, kind):
    graph = [app_ld(site)] if kind == "home" else []
    if kind == "home" and site["cfg"].get("faq"):
        graph.append({"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q["q"],
             "acceptedAnswer": {"@type": "Answer", "text": q["a"]}}
            for q in site["cfg"]["faq"]]})
    if kind == "doc":
        url = site["base"] + page["path"]
        graph.append({"@type": "TechArticle", "headline": page["h1"], "url": url,
                      "description": page["desc"], "dateModified": page["lastmod"],
                      "inLanguage": site["lang"], "about": {"@id": site["base"] + "#app"}})
        graph.append({"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": site["name"], "item": site["base"]},
            {"@type": "ListItem", "position": 2, "name": page["h1"], "item": url}]})
    if not graph:
        return ""
    data = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False,
                      indent=1).replace("</", "<\\/")
    return f'<script type="application/ld+json">\n{data}\n</script>\n'


def shell(site, page, body, pages, kind):
    ui, base, name = site["ui"], site["base"], site["name"]
    pre = "/" + base.rstrip("/").rsplit("/", 1)[1] + "/" if kind == "404" \
        else "../" * page["path"].count("/")
    url = base + page["path"]
    robots = "noindex" if kind == "404" else "index,follow"
    canon = "" if kind == "404" else f'<link rel="canonical" href="{e(url)}">\n'
    if kind == "doc":
        body = doc_body(site, page, pages, pre)
    elif kind == "404":
        body = (f'<section class="hero"><h1>{e(ui["notfound"])}</h1>'
                f'<p><a class="button primary" href="{pre}">{e(ui["back"])}</a></p></section>')
    nav_docs = ' aria-current="page"' if kind == "doc" else ""
    return f"""<!doctype html>
<html lang="{site['lang']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(page['title'])}</title>
<meta name="description" content="{e(page['desc'])}">
<meta name="robots" content="{robots}">
{canon}<meta name="theme-color" content="#176550">
<meta property="og:type" content="{'website' if kind == 'home' else 'article'}">
<meta property="og:title" content="{e(page['title'])}">
<meta property="og:description" content="{e(page['desc'])}">
<meta property="og:url" content="{e(url)}">
<meta property="og:site_name" content="{e(name)}">
<meta property="og:locale" content="{ui['locale']}">
<meta property="og:image" content="{e(site['og'])}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(page['title'])}">
<meta name="twitter:description" content="{e(page['desc'])}">
<meta name="twitter:image" content="{e(site['og'])}">
<link rel="stylesheet" href="{pre}assets/site.css">
<link rel="alternate" type="text/markdown" title="llms.txt" href="{pre}llms.txt">
{json_ld(site, page, kind)}</head>
<body>
<a class="skip" href="#main">{e(ui['skip'])}</a>
<div class="top"><header class="wrap">
<a class="brand" href="{pre}">{e(name)}</a>
<nav><a href="{pre}docs/"{nav_docs}>{e(ui['docs'])}</a><a href="{e(site['gh'])}">{e(ui['source'])}</a></nav>
</header></div>
<main id="main" class="wrap">
{body}
</main>
<footer class="wrap"><p>{e(name)} · <a href="{e(site['gh'])}">{e(site['gh'][8:])}</a> · {e(ui['license'])}: {e(site['cfg'].get('license', 'MIT'))}</p>
<p>{e(ui['generated'])} <a href="{pre}llms.txt">llms.txt</a> · <a href="{pre}sitemap.xml">sitemap.xml</a></p></footer>
</body>
</html>
"""


def landing_body(site, parts, pages):
    cfg, ui = site["cfg"], site["ui"]
    first = parts[0][0] if parts else ""
    out = [f'<section class="hero"><p class="eyebrow">{e(cfg.get("eyebrow", "Open source"))}</p>',
           f'<h1>{e(cfg.get("headline", site["name"]))}</h1><p>{e(cfg["description"])}</p>',
           '<p class="buttons">']
    if first:
        out.append(f'<a class="button primary" href="#{_sid(first)}">{e(ui["start"])}</a>')
    out.append(f'<a class="button" href="docs/">{e(ui["read_docs"])}</a>'
               f'<a class="button" href="{e(site["gh"])}">{e(ui["view_source"])}</a></p></section>')
    if cfg.get("features"):
        out.append(f'<section><h2 id="features">{e(ui["features"])}</h2><ul class="cards">'
                   + "".join(f"<li>{e(f)}</li>" for f in cfg["features"]) + "</ul></section>")
    for title, body in parts:
        out.append(f'<section class="md"><h2 id="{_sid(title)}">{e(title)}</h2>\n{body}</section>')
    if cfg.get("faq"):
        out.append(f'<section><h2 id="faq">{e(ui["faq"])}</h2>' + "".join(
            f'<details><summary>{e(q["q"])}</summary><p>{e(q["a"])}</p></details>'
            for q in cfg["faq"]) + "</section>")
    out.append(f'<section><h2 id="docs">{e(ui["pages"])}</h2><ul class="pages">' + "".join(
        f'<li><a href="{p["path"]}">{e(p["h1"])}</a><span>{e(p["desc"])}</span></li>'
        for p in pages) + "</ul></section>")
    return "\n".join(out)


def _sid(title):
    return "s-" + "".join(c if c.isalnum() else "-" for c in title.lower()).strip("-")


def doc_body(site, page, pages, pre):
    ui = site["ui"]
    toc = "".join(f'<li><a href="#{hid}">{e(t)}</a></li>' for lvl, t, hid in page["toc"] if lvl == 2)
    others = "".join(
        f'<li><a href="{pre}{p["path"]}"{" aria-current=page" if p is page else ""}>{e(p["h1"])}</a></li>'
        for p in pages)
    edit = f'{site["gh"]}/blob/{site.get("branch", "HEAD")}/{page["src"]}'
    return (f'<div class="doc"><aside><details open><summary>{e(ui["contents"])}</summary>'
            f'<ul>{toc}</ul></details><details open><summary>{e(ui["pages"])}</summary>'
            f'<ul>{others}</ul></details></aside>'
            f'<article class="md">{page["body"]}<p class="edit"><a href="{e(edit)}">'
            f'{e(ui["edit"])}</a> · {page["lastmod"]}</p></article></div>')
