#!/usr/bin/env python3
"""Wiring check for the milestone (author's probe, stdlib only).

Usage: python3 docs/specs/mcpb-checksums-wiring.py <workflow.yml> <needle> [<needle> ...]

Full-line YAML comments are dropped first, then every needle must occur in the
remaining text, each one AFTER the previous match. Exit 0 when all are found in
order; otherwise print the first missing needle and exit 1.
"""
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"FAIL: no such workflow {path}", file=sys.stderr)
        return 1
    lines = path.read_text(encoding="utf-8").splitlines()
    text = "\n".join(l for l in lines if not l.lstrip().startswith("#"))
    pos = 0
    for needle in sys.argv[2:]:
        found = text.find(needle, pos)
        if found < 0:
            where = "anywhere" if text.find(needle) < 0 else "after the previous step"
            print(f"FAIL: {needle!r} not found {where} in {path}", file=sys.stderr)
            return 1
        print(f"ok: {needle!r} at offset {found}")
        pos = found + len(needle)
    print("WIRING OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
