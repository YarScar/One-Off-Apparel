/**
 * dump-parity-strings.ts — emit the normalized operand strings for the G2 parity fixture.
 *
 * `regenerate-seq-ratio-parity.py` runs this and computes CPython `difflib` ratios over what it
 * prints. The strings come from this package's own `normalize()` rather than being re-derived in
 * Python, so the fixture can never disagree with the TypeScript side about tokenization — the parity
 * it records is exactly `ratio()`, which is the function under port.
 *
 * Run from the repo root:  pnpm exec tsx packages/grants/scripts/dump-parity-strings.ts
 */

import { listFormIds, loadBank, loadForm } from '../src/data.js';
import { normalize } from '../src/matcher.js';

/** What `score()` passes as `b`: every canonical phrasing and every recorded funder variant. */
function candidateStrings(): string[] {
  const bank = loadBank();
  const out: string[] = [];
  for (const q of bank.questions) {
    out.push(normalize(q.canonical).join(' '));
    for (const v of q.variants) out.push(normalize(v.text).join(' '));
  }
  return out;
}

/** The canonical phrasings alone. Used as `a` too — matching a canonical is the confident path. */
function canonicalStrings(): string[] {
  return loadBank().questions.map((q) => normalize(q.canonical).join(' '));
}

/** What `score()` passes as `a`: real funder wordings, captured across every form fixture. */
function incomingStrings(): string[] {
  return listFormIds().flatMap((id) =>
    loadForm(id).questions.map((q) => normalize(q.text).join(' ')),
  );
}

const dedupe = (xs: readonly string[]): string[] => [...new Set(xs)].filter((s) => s !== '');

process.stdout.write(
  `${JSON.stringify(
    {
      candidates: dedupe(candidateStrings()),
      canonicals: dedupe(canonicalStrings()),
      incoming: dedupe(incomingStrings()),
    },
    null,
    2,
  )}\n`,
);
