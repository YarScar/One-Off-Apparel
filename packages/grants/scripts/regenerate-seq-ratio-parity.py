"""
regenerate-seq-ratio-parity.py — regenerate packages/grants/src/__fixtures__/seq-ratio-parity.json.

The fixture records CPython `difflib.SequenceMatcher(None, a, b).ratio()` over the real bank, and
`src/seq-ratio.test.ts` asserts the TypeScript port reproduces every value exactly. That is the G2
acceptance bar (`admin/SPEC.md` §5), so the fixture is only as good as its coverage of the bank it
was generated from: a bank edit that adds candidate strings and no regenerate leaves the new strings
untested while the suite stays green. `data.test.ts`/`seq-ratio.test.ts` now fail on that state
rather than passing quietly, and this script is how you clear the failure.

Unlike `regenerate-matcher-parity.py`, this needs no prototype checkout — `ratio()` is CPython
stdlib. It does need this package's own `normalize()`, which it reads by running
`scripts/dump-parity-strings.ts` under tsx, so the fixture can never disagree with the TypeScript
side about tokenization.

## Operand set

- `b` (the candidate) is every normalized canonical phrasing and recorded funder variant. `difflib`'s
  autojunk heuristic is computed over `b` alone, so full candidate coverage on this side is the point
  of the fixture, and the test asserts it.
- `a` (the incoming question) is every normalized question text across `seed/forms/*.json` — real
  funder wordings — plus every canonical phrasing, each crossed with every candidate. That is exactly
  the comparison `matcher.score()` performs, on both the confident path (a canonical arrives verbatim)
  and the realistic one (a funder's own wording arrives).
- Every candidate at or over the 200-character autojunk threshold is additionally used as `a` against
  every candidate, so the asymmetric path is recorded in both orientations.

## Procedure

1. Run a CONTROL PASS first: `--control` recomputes and diffs against the checked-in fixture without
   writing. Every pair present in both must be bit-identical; anything else means CPython changed
   under you (check `python_version`) or `normalize()` moved, and the harness is not trusted to
   replace the fixture.
2. Regenerate, then read the diff. A healthy bank edit only appends.
3. Run `pnpm exec vitest run packages/grants`.

Usage (from the repo root):
    python3 packages/grants/scripts/regenerate-seq-ratio-parity.py --control
    python3 packages/grants/scripts/regenerate-seq-ratio-parity.py --date 2026-08-03
"""

from __future__ import annotations

import argparse
import difflib
import json
import platform
import subprocess
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PACKAGE_ROOT.parents[1]
DUMPER = Path("packages/grants/scripts/dump-parity-strings.ts")
FIXTURE = PACKAGE_ROOT / "src" / "__fixtures__" / "seq-ratio-parity.json"

# Mirrors AUTOJUNK_MIN_LENGTH in src/seq-ratio.ts. difflib applies the heuristic to sequences of at
# least 200 elements; a candidate under it can never exercise that path.
AUTOJUNK_MIN_LENGTH = 200

NOTE = (
    "Generated from CPython difflib.SequenceMatcher(None, a, b).ratio() by "
    "packages/grants/scripts/regenerate-seq-ratio-parity.py. Do not hand-edit. Strings are "
    "deduplicated into `strings`; each pair is [a_index, b_index, ratio]."
)


def load_strings() -> tuple[list[str], list[str], list[str]]:
    """Candidate, canonical, and incoming strings, normalized by the TypeScript side."""
    proc = subprocess.run(
        ["pnpm", "exec", "tsx", str(DUMPER)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        raise SystemExit(f"error: {DUMPER} failed (exit {proc.returncode}).")
    data = json.loads(proc.stdout)
    return data["candidates"], data["canonicals"], data["incoming"]


def build_pairs(
    candidates: list[str], canonicals: list[str], incoming: list[str]
) -> list[tuple[str, str]]:
    """Ordered (a, b) operand pairs, deduplicated, in a stable order."""
    a_side: list[str] = []
    seen_a: set[str] = set()
    for s in [*incoming, *canonicals, *[c for c in candidates if len(c) >= AUTOJUNK_MIN_LENGTH]]:
        if s not in seen_a:
            a_side.append(s)
            seen_a.add(s)

    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for a in a_side:
        for b in candidates:
            if (a, b) not in seen:
                seen.add((a, b))
                pairs.append((a, b))
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--control", action="store_true", help="diff against the existing fixture without writing"
    )
    parser.add_argument(
        "--date", help="ISO date to stamp as `generated` (default: keep the existing stamp)"
    )
    args = parser.parse_args()

    candidates, canonicals, incoming = load_strings()
    pairs = build_pairs(candidates, canonicals, incoming)

    ratios = {(a, b): difflib.SequenceMatcher(None, a, b).ratio() for a, b in pairs}

    old = json.loads(FIXTURE.read_text(encoding="utf-8")) if FIXTURE.exists() else None

    if args.control:
        if old is None:
            print("control: no existing fixture to diff against", file=sys.stderr)
            return 2
        old_strings = old["strings"]
        diffs = 0
        overlap = 0
        for ai, bi, want in old["pairs"]:
            key = (old_strings[ai], old_strings[bi])
            got = ratios.get(key)
            if got is None:
                continue
            overlap += 1
            if got != want:
                diffs += 1
                print(f"DIFF a={key[0][:40]!r} b={key[1][:40]!r} got={got!r} want={want!r}")
        covered_b = {b for _, b in pairs}
        uncovered = [c for c in candidates if c not in covered_b]
        print(f"control: {overlap} overlapping pair(s), {diffs} regression difference(s)")
        print(f"control: {len(pairs) - overlap} pair(s) not in the checked-in fixture")
        if uncovered:
            print(f"control: {len(uncovered)} candidate(s) with no b-side pair — bug in this script")
        if old["python_version"] != platform.python_version():
            print(f"control: python {old['python_version']} -> {platform.python_version()}")
        return 0 if diffs == 0 else 1

    strings: list[str] = []
    index: dict[str, int] = {}

    def idx(s: str) -> int:
        if s not in index:
            index[s] = len(strings)
            strings.append(s)
        return index[s]

    encoded = [[idx(a), idx(b), ratios[(a, b)]] for a, b in pairs]

    generated = args.date or (old["generated"] if old else "")
    fixture = {
        "note": NOTE,
        "generated": generated,
        "python_version": platform.python_version(),
        "autojunk_candidates": [c for c in candidates if len(c) >= AUTOJUNK_MIN_LENGTH],
        "strings": strings,
        "pairs": encoded,
    }
    # Compact, as the 2026-07-29 fixture was: pretty-printing 58k pairs costs ~1.5 MB in whitespace
    # and the file is generated, never read by a human.
    FIXTURE.write_text(
        json.dumps(fixture, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {FIXTURE} — {len(strings)} strings, {len(encoded)} pairs, "
        f"{len(fixture['autojunk_candidates'])} autojunk candidate(s), "
        f"python {fixture['python_version']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
