"""Self-check of the built site: tag balance, JSON-LD, internal links and anchors."""
import json
import pathlib
import urllib.parse
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source",
        "track", "wbr"}
OPTIONAL_END = {"p", "li", "td", "th", "tr", "thead", "tbody", "dt", "dd", "option"}


class Scan(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids, self.links, self.stack, self.errors = set(), [], [], []
        self.ld, self._in_ld, self.canonical = [], False, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            if a["id"] in self.ids:
                self.errors.append(f"duplicate id {a['id']}")
            self.ids.add(a["id"])
        for k in ("href", "src"):
            if a.get(k) is not None:
                self.links.append(a[k])
        if tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        self._in_ld = tag == "script" and a.get("type") == "application/ld+json"
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        while self.stack and self.stack[-1] != tag and self.stack[-1] in OPTIONAL_END:
            self.stack.pop()
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f"unexpected </{tag}> (open: {self.stack[-3:]})")
            return
        self.stack.pop()
        self._in_ld = False

    def handle_data(self, data):
        if self._in_ld:
            self.ld.append(data)


def run(out, base):
    out = pathlib.Path(out).resolve()
    scans, errors = {}, []
    for f in sorted(out.rglob("*.html")):
        s = Scan()
        s.feed(f.read_text(encoding="utf-8"))
        s.close()
        rest = [t for t in s.stack if t not in OPTIONAL_END]
        if rest:
            errors.append(f"{f}: unclosed {rest}")
        errors += [f"{f}: {x}" for x in s.errors]
        for blob in s.ld:
            try:
                json.loads(blob)
            except json.JSONDecodeError as exc:
                errors.append(f"{f}: bad JSON-LD ({exc})")
        rel = f.relative_to(out).as_posix()
        want = base + (rel[:-len("index.html")] if rel.endswith("index.html") else rel)
        if s.canonical is not None and s.canonical != want:
            errors.append(f"{f}: canonical {s.canonical} != {want}")
        scans[f] = s
    root_path = urllib.parse.urlparse(base).path
    for f, s in scans.items():
        if f.name == "404.html":
            continue
        for link in s.links:
            u = urllib.parse.urlparse(link)
            if u.scheme or link.startswith("//"):
                continue
            target = (f.parent / u.path).resolve() if u.path else f
            if u.path.startswith("/"):
                target = (out / u.path[len(root_path):]).resolve()
            if target.is_dir():
                target = target / "index.html"
            if not target.exists():
                errors.append(f"{f}: broken link {link}")
            elif u.fragment and target in scans and \
                    urllib.parse.unquote(u.fragment) not in scans[target].ids:
                errors.append(f"{f}: missing anchor {link}")
    return errors
