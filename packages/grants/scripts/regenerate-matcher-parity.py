"""
regenerate-matcher-parity.py — regenerate packages/grants/src/__fixtures__/matcher-parity.json.

The fixture is generated from the prototype's `matcher.py match_question()`. Do not hand-edit the
fixture, and do not modify matcher.py — parity means parity with the prototype that produced
Launchpad's filed applications.

The prototype is deliberately NOT in this repository (`packages/grants/admin/TAD.md` §2.5) but lives
on the build machine — pass its pipeline directory with --prototype (e.g. ~/Projects/Grants/pipeline).

Procedure (see packages/grants/CHANGELOG.md, 2026-08-03 entry):

1. The inputs are recoverable from the fixture itself: every case carries its `incoming` string.
   Run a CONTROL PASS first — regenerate from the CURRENT fixture + CURRENT bank and diff. It must
   report zero regression differences, or this harness is not trusted to replace the fixture.
2. Copy the updated seed/questions.json over the prototype's question-bank/questions.json (the bank
   must be byte-identical), then run this script. It reads the existing fixture for the case inputs,
   appends any new bank texts and form-fixture question texts not already covered, and re-runs the
   prototype matcher.
3. Read the diff. A healthy bank edit changes only the cases that should change.

Usage:
    python3 packages/grants/scripts/regenerate-matcher-parity.py \\
        --prototype ~/Projects/Grants/pipeline \\
        packages/grants/src/__fixtures__/matcher-parity.json
    python3 packages/grants/scripts/regenerate-matcher-parity.py --control \\
        --prototype ~/Projects/Grants/pipeline \\
        packages/grants/src/__fixtures__/matcher-parity.json

The --prototype directory must contain matcher.py; its parent must contain question-bank/questions.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path, help="path to packages/grants/src/__fixtures__/matcher-parity.json")
    parser.add_argument(
        "--prototype",
        type=Path,
        default=Path.home() / "Projects" / "Grants" / "pipeline",
        help="prototype pipeline dir containing matcher.py (default: ~/Projects/Grants/pipeline)",
    )
    parser.add_argument(
        "--control", action="store_true", help="diff against the existing fixture without writing"
    )
    args = parser.parse_args()

    if not (args.prototype / "matcher.py").exists():
        print(
            f"error: {args.prototype / 'matcher.py'} not found. Pass --prototype pointing at the "
            f"prototype's pipeline/ directory.",
            file=sys.stderr,
        )
        return 2

    sys.path.insert(0, str(args.prototype))
    from matcher import match_question  # type: ignore[import-not-found]

    bank_path = args.prototype.parent / "question-bank" / "questions.json"
    if not bank_path.exists():
        print(f"error: {bank_path} not found. Copy seed/questions.json there first.", file=sys.stderr)
        return 2

    fixture_path = args.fixture
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    bank = json.loads(bank_path.read_text(encoding="utf-8"))
    repo_seed = REPO_ROOT / "seed"

    inputs = build_inputs(bank, fixture, repo_seed)
    cases = []
    for text in inputs:
        r = match_question(text, bank)
        cases.append({"incoming": text, "expected": asdict(r)})

    new_fixture = {
        "note": fixture.get("note", "Generated from the prototype's matcher.py match_question(). Do not hand-edit."),
        "bank_version": bank["meta"]["version"],
        "cases": cases,
        "threshold_cases": fixture["threshold_cases"],
    }

    if args.control:
        diffs = 0
        # Compare only the cases that exist in both — appended cases (new bank texts / form texts
        # not in the old fixture) are expected additions, not regressions.
        old_by_incoming = {c["incoming"]: c["expected"] for c in fixture["cases"]}
        for c in new_fixture["cases"]:
            want = old_by_incoming.get(c["incoming"])
            if want is None:
                continue
            if c["expected"] != want:
                diffs += 1
                print(f"DIFF {c['incoming'][:60]!r}")
                print(f"   got: {json.dumps(c['expected'], sort_keys=True)}")
                print(f"   want:{json.dumps(want, sort_keys=True)}")
        if new_fixture["bank_version"] != fixture["bank_version"]:
            print(f"BANK VERSION {fixture['bank_version']} -> {new_fixture['bank_version']}")
            diffs += 1
        added = len(new_fixture["cases"]) - len(fixture["cases"])
        if added:
            print(f"APPENDED {added} new case(s) (expected)")
        print(f"control: {diffs} regression differences")
        return 0 if diffs == 0 else 1

    fixture_path.write_text(
        json.dumps(new_fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {fixture_path} — {len(new_fixture['cases'])} cases, "
        f"bank_version {new_fixture['bank_version']}"
    )
    return 0


def all_bank_texts(bank: dict) -> list[str]:
    """Canonical phrasings + every recorded funder wording, in bank order."""
    out: list[str] = []
    for q in bank["questions"]:
        out.append(q["canonical"])
        for v in q.get("variants", []):
            out.append(v["text"])
    return out


def form_texts(repo_seed: Path) -> list[str]:
    """Every question text across the repo's form fixtures."""
    texts: list[str] = []
    for fixture in sorted((repo_seed / "forms").glob("*.json")):
        with open(fixture, encoding="utf-8") as fh:
            data = json.load(fh)
        for q in data.get("questions", []):
            texts.append(q["text"])
    return texts


def build_inputs(bank: dict, fixture: dict, repo_seed: Path) -> list[str]:
    """Existing fixture inputs, plus any bank texts or form texts not already covered."""
    inputs: list[str] = [c["incoming"] for c in fixture["cases"]]
    seen = set(inputs)
    for t in all_bank_texts(bank):
        if t not in seen:
            inputs.append(t)
            seen.add(t)
    for t in form_texts(repo_seed):
        if t not in seen:
            inputs.append(t)
            seen.add(t)
    return inputs


if __name__ == "__main__":
    raise SystemExit(main())
