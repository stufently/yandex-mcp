"""Minimal GitHub-flavoured Markdown to HTML (stdlib only).

Covers what READMEs use: headings with GitHub anchors, fenced code, lists,
tables, blockquotes, raw HTML blocks, links, images, emphasis, inline code.
"""
import html
import re

FENCE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)")
HEAD = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
HR = re.compile(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$")
ITEM = re.compile(r"^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$")
TSEP = re.compile(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$")
HTMLBLK = re.compile(r"^\s*</?[a-zA-Z][\w-]*[\s>/]|^\s*<!--")
INLINE_TAGS = ("br", "kbd", "sup", "sub", "b", "i", "em", "strong", "code")


def slugify(text):
    text = re.sub(r"<[^>]+>", "", text).strip().lower()
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def plain(md_inline):
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", md_inline)
    return re.sub(r"[`*_~]", "", t).strip()


class Renderer:
    def __init__(self, resolve=lambda u: u):
        self.resolve = resolve
        self.headings = []  # (level, text, id)
        self._ids = {}

    def _anchor(self, text):
        base = slugify(text) or "section"
        n = self._ids.get(base, 0)
        self._ids[base] = n + 1
        return base if n == 0 else f"{base}-{n}"

    # ---------- inline ----------
    def inline(self, s):
        top = not hasattr(self, "_keep") or self._keep is None
        if top:
            self._keep = []
        keep = self._keep

        def stash(v):
            keep.append(v)
            return f"\x00{len(keep) - 1}\x00"

        s = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|<>~])", lambda m: stash(html.escape(m[1])), s)
        s = re.sub(r"(`+)(.+?)\1", lambda m: stash(f"<code>{html.escape(m[2].strip())}</code>"), s)
        s = re.sub(r"<(https?://[^>\s]+)>", lambda m: stash(self._a(m[1], html.escape(m[1]))), s)
        tags = "|".join(INLINE_TAGS)
        s = re.sub(rf"</?(?:{tags})\s*/?>", lambda m: stash(m[0]), s, flags=re.I)
        s = re.sub(r"!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)",
                   lambda m: stash(f'<img src="{html.escape(self.resolve(m[2]), True)}" '
                                   f'alt="{html.escape(plain(m[1]), True)}" loading="lazy">'), s)
        s = re.sub(r"\[((?:[^\[\]]|\[[^\]]*\])+)\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)",
                   lambda m: stash(self._a(m[2], self.inline(m[1]))), s)
        s = re.sub(r"https?://[^\s<>()\x00]*[^\s<>().,;:!?'\"\x00]",
                   lambda m: stash(self._a(m[0], html.escape(m[0]))), s)
        s = html.escape(s, quote=False)
        s = re.sub(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1", r"<strong>\2</strong>", s, flags=re.S)
        s = re.sub(r"(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])", r"<em>\1</em>", s)
        s = re.sub(r"(?<![\w_])_(?=\S)(.+?)(?<=\S)_(?![\w_])", r"<em>\1</em>", s)
        s = re.sub(r"~~(?=\S)(.+?)(?<=\S)~~", r"<del>\1</del>", s)
        s = re.sub(r"( {2,}|\\)\n", "<br>\n", s)
        if top:
            while "\x00" in s:
                s = re.sub(r"\x00(\d+)\x00", lambda m: keep[int(m[1])], s)
            self._keep = None
        return s

    def _a(self, url, text):
        href = html.escape(self.resolve(url), True)
        ext = ' rel="noopener"' if href.startswith("http") else ""
        return f'<a href="{href}"{ext}>{text}</a>'

    # ---------- blocks ----------
    def render(self, text):
        lines = text.replace("\t", "    ").replace("\r\n", "\n").split("\n")
        return "\n".join(self._blocks(lines))

    def _blocks(self, lines):
        out, i, n = [], 0, len(lines)
        while i < n:
            line = lines[i]
            if not line.strip():
                i += 1
                continue
            m = FENCE.match(line)
            if m:
                fence, lang, body = m[2], m[3], []
                i += 1
                while i < n and not lines[i].strip().startswith(fence):
                    body.append(lines[i][len(m[1]):] if lines[i].startswith(m[1]) else lines[i])
                    i += 1
                cls = f' class="language-{html.escape(lang, True)}"' if lang else ""
                out.append(f"<pre><code{cls}>{html.escape(chr(10).join(body))}</code></pre>")
                i += 1
                continue
            m = HEAD.match(line)
            if m:
                lvl, txt = len(m[1]), m[2]
                hid = self._anchor(plain(txt))
                self.headings.append((lvl, plain(txt), hid))
                out.append(f'<h{lvl} id="{hid}">{self.inline(txt)}</h{lvl}>')
                i += 1
                continue
            if HR.match(line):
                out.append("<hr>")
                i += 1
                continue
            if "|" in line and i + 1 < n and TSEP.match(lines[i + 1]) and "-" in lines[i + 1]:
                i = self._table(lines, i, out)
                continue
            if line.lstrip().startswith(">"):
                body = []
                while i < n and lines[i].strip() and lines[i].lstrip().startswith(">"):
                    body.append(re.sub(r"^\s*> ?", "", lines[i]))
                    i += 1
                out.append("<blockquote>\n" + "\n".join(self._blocks(body)) + "\n</blockquote>")
                continue
            if ITEM.match(line):
                i = self._list(lines, i, out)
                continue
            if HTMLBLK.match(line):
                while i < n and lines[i].strip():
                    out.append(lines[i])
                    i += 1
                continue
            para = []
            while i < n and lines[i].strip() and not self._starts_block(lines, i):
                para.append(lines[i].strip() if not lines[i].endswith("  ") else lines[i].lstrip())
                i += 1
            out.append(f"<p>{self.inline(chr(10).join(para))}</p>")
        return out

    def _starts_block(self, lines, i):
        line = lines[i]
        return bool(FENCE.match(line) or HEAD.match(line) or HR.match(line) or ITEM.match(line)
                    or line.lstrip().startswith(">")
                    or ("|" in line and i + 1 < len(lines) and TSEP.match(lines[i + 1])
                        and "-" in lines[i + 1]))

    def _table(self, lines, i, out):
        def cells(row):
            row = row.strip().strip("|")
            return [c.strip() for c in re.split(r"(?<!\\)\|", row)]

        aligns = []
        for c in cells(lines[i + 1]):
            aligns.append("center" if c.startswith(":") and c.endswith(":")
                          else "right" if c.endswith(":") else "")
        head = cells(lines[i])
        rows = ["<thead><tr>" + "".join(self._td("th", c, aligns, k)
                                        for k, c in enumerate(head)) + "</tr></thead><tbody>"]
        i += 2
        while i < len(lines) and lines[i].strip() and "|" in lines[i]:
            rows.append("<tr>" + "".join(self._td("td", c, aligns, k)
                                         for k, c in enumerate(cells(lines[i]))) + "</tr>")
            i += 1
        out.append('<div class="table"><table>' + "".join(rows) + "</tbody></table></div>")
        return i

    def _td(self, tag, cell, aligns, k):
        al = aligns[k] if k < len(aligns) else ""
        style = f' style="text-align:{al}"' if al else ""
        return f"<{tag}{style}>{self.inline(cell.replace(chr(92) + '|', '|'))}</{tag}>"

    def _list(self, lines, i, out):
        first = ITEM.match(lines[i])
        indent, ordered = len(first[1]), first[2][0].isdigit()
        items, n = [], len(lines)
        while i < n:
            m = ITEM.match(lines[i])
            if not m or len(m[1]) != indent or m[2][0].isdigit() != ordered:
                break
            body, i = [m[3]], i + 1
            while i < n:
                cur = lines[i]
                if not cur.strip():
                    nxt = lines[i + 1] if i + 1 < n else ""
                    if nxt.strip() and (len(nxt) - len(nxt.lstrip())) > indent:
                        body.append("")
                        i += 1
                        continue
                    break
                cm = ITEM.match(cur)
                if cm and len(cm[1]) <= indent:
                    break
                if not cm and len(cur) - len(cur.lstrip()) <= indent and self._starts_block(lines, i):
                    break
                body.append(cur[indent + 2:] if cur[:indent + 2].strip() == "" else cur.lstrip())
                i += 1
            items.append(body)
            if i < n and not lines[i].strip() and i + 1 < n and ITEM.match(lines[i + 1]) \
                    and len(ITEM.match(lines[i + 1])[1]) == indent:
                i += 1
        tag = "ol" if ordered else "ul"
        start = int(first[2][:-1]) if ordered else 1
        attr = f' start="{start}"' if ordered and start != 1 else ""
        html_items = []
        for body in items:
            inner = self._blocks(body)
            if len(inner) >= 1 and inner[0].startswith("<p>") and "" not in body:
                inner[0] = inner[0][3:-4]
            html_items.append("<li>" + "\n".join(inner) + "</li>")
        out.append(f"<{tag}{attr}>" + "\n".join(html_items) + f"</{tag}>")
        return i
