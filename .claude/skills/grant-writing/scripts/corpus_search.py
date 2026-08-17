#!/usr/bin/env python3
"""Search prior filed Launchpad applications for how a question was already answered.

The highest-yield gap-fill source is a question someone has already answered for another funder.
This greps the extracted grant corpus and prints the matching heading plus the text that follows it.

  corpus_search.py "statement of need" [--root DIR] [--context N] [--max N]

The server has no local grants mirror — this is a dev-machine fallback. The primary path is the
Drive MCP chain (search_documents over the ingested grants corpus). Default root is
data/Grants (the untracked local mirror); it does not exist on the server.

Output is raw prior text. It is a research lead, not a draft: every figure in it is stale until
re-verified against live data, and every named entity is unconfirmed until traced.
"""
import argparse
import glob
import html
import os
import re
import zipfile
from pathlib import Path

DEFAULT_ROOT = str(Path(__file__).resolve().parents[4] / "data" / "Grants")


def paragraphs(path: str) -> list[str]:
    try:
        z = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        return []
    out: list[str] = []
    for name in z.namelist():
        if not name.endswith(".xml") or "word/document" not in name:
            continue
        try:
            x = z.read(name).decode("utf8", "ignore")
        except Exception:
            continue
        x = re.sub(r"</w:p>", "\n", x)
        x = re.sub(r"<[^>]+>", "", x)
        out.extend(" ".join(p.split()) for p in html.unescape(x).split("\n"))
    return [p for p in out if p]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("terms", nargs="+")
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--context", type=int, default=4, help="paragraphs to print after a hit")
    ap.add_argument("--max", type=int, default=12, help="max hits to print")
    a = ap.parse_args()

    if not os.path.isdir(a.root):
        print(f"corpus root not found: {a.root}")
        return 1

    terms = [t.lower() for t in a.terms]
    hits = 0
    for path in sorted(glob.glob(os.path.join(a.root, "**", "*.docx"), recursive=True)):
        paras = paragraphs(path)
        for i, p in enumerate(paras):
            low = p.lower()
            if not all(t in low for t in terms):
                continue
            if len(p) > 400:  # a hit inside a long paragraph is the answer, not the label
                continue
            rel = os.path.relpath(path, a.root)
            print(f"\n=== {rel}")
            print(f"    MATCH: {p[:200]}")
            for follow in paras[i + 1 : i + 1 + a.context]:
                print(f"      | {follow[:300]}")
            hits += 1
            if hits >= a.max:
                print(f"\n({a.max} hit cap reached — narrow the terms for more precision)")
                return 0
            break  # one hit per document keeps the output readable
    print(f"\n{hits} document(s) matched {a.terms}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
