/**
 * py.ts — counting and rounding primitives with Python semantics.
 *
 * Funder length limits are a submittable constraint, so counting has to be exact and has to agree
 * with the prototype that produced LaunchPad's filed applications. These five operations behave
 * differently in JS than the natural translation suggests. Each one removes a class of silent
 * defect rather than fixing an observed bug — see the note on {@link pyLen}.
 */

/**
 * The characters Python considers whitespace, which are NOT the characters JS `\s` matches.
 *
 * `str.split()` uses `Py_UNICODE_ISSPACE`, and the two sets differ at both ends:
 *
 * - Python treats U+001C–U+001F (the file/group/record/unit separators) and U+0085 (NEL) as
 *   whitespace; JS `\s` does not. U+0085 in particular rides in on text pasted out of Word or Google
 *   Docs, and a run of it would be counted into the middle of a token, reporting one word fewer than
 *   Python against a hard funder cap.
 * - JS `\s` matches U+FEFF (BOM); Python does not. A leading BOM on a pasted answer is one word in
 *   Python and zero in a naive port.
 *
 * As with {@link pyLen}, this is a latent class rather than an observed bug — no such character is in
 * the seed today. It is spelled out because the fix is free and the failure would present as an
 * arithmetic error in the one part of the layer that is supposed to be pure arithmetic.
 */
const PY_SPACE_CLASS =
  '\\t\\n\\v\\f\\r\\x1c\\x1d\\x1e\\x1f \\x85\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

const PY_SPACE_RUN = new RegExp(`[${PY_SPACE_CLASS}]+`, 'g');
const PY_SPACE_LEADING = new RegExp(`^[${PY_SPACE_CLASS}]+`);
const PY_SPACE_TRAILING = new RegExp(`[${PY_SPACE_CLASS}]+$`);
/** Split point for {@link pySplitSentences}: terminal punctuation followed by Python whitespace. */
const PY_SENTENCE_BREAK = new RegExp(`(?<=[.!?])[${PY_SPACE_CLASS}]+`);

/**
 * Python's `str.split()` with no argument: splits on runs of whitespace, strips leading and
 * trailing whitespace, and returns `[]` for an all-whitespace string.
 *
 * The trap: `''.split(/\s+/)` is `['']` (length 1), so a naive port reports an empty answer as
 * 1 word. Whitespace is {@link PY_SPACE_CLASS}, not JS `\s`.
 */
export function pySplit(text: string): string[] {
  const trimmed = text.replace(PY_SPACE_LEADING, '').replace(PY_SPACE_TRAILING, '');
  return trimmed === '' ? [] : trimmed.split(PY_SPACE_RUN);
}

/**
 * Python's `len(str)` counts code points; JS `.length` counts UTF-16 code units. They differ only
 * outside the Basic Multilingual Plane — `🚀` is 1 code point and 2 code units.
 *
 * **This risk is latent, not measured.** A check on 2026-07-28 found no such character in either
 * seed file, so both counts agree today. An earlier revision of this comment cited `—`, `≥`, `⚠`
 * and `✅` as evidence; that was wrong, since all four are inside the BMP and count as 1 either way.
 *
 * The primitive stays because one emoji in a future KB answer would overcount silently against
 * Truist's tightest 30-character cap, and the failure would present as a limit error rather than an
 * encoding error. It costs nothing and removes the class.
 */
export function pyLen(text: string): number {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code points are the contract
  return [...text].length;
}

/**
 * Python's `str.rstrip()` — trailing whitespace only. `String.prototype.trim()` also strips the
 * leading side, which would corrupt a truncation preview.
 */
export function pyRstrip(text: string): string {
  return text.replace(PY_SPACE_TRAILING, '');
}

/**
 * Sentence count: split on runs of `.!?` and keep the non-blank pieces.
 *
 * Deliberately a different rule from {@link pySplitSentences} — the prototype uses one pattern for
 * counting and another for truncating, and unifying them changes output.
 */
export function pyCountSentences(text: string): number {
  return text.split(/[.!?]+/).filter((s) => pySplit(s).length > 0).length;
}

/**
 * Sentence split for truncation: lookbehind split that keeps terminal punctuation attached to the
 * sentence it ends.
 */
export function pySplitSentences(text: string): string[] {
  return text.split(PY_SENTENCE_BREAK);
}

/**
 * Python's `round(x, ndigits)`. The matcher reports `round(best_score, 3)`, and that rounded value
 * is what the confidence threshold and every stored expectation compare against, so a divergence
 * here shows up as a changed match.
 *
 * Python rounds half-to-even; `Math.round` rounds half-up and only to an integer. The reason
 * `toFixed` is safe as the implementation, rather than a hand-rolled half-even routine:
 *
 * - Both Python and `toFixed` round the *exact binary value* of the double, not its shortest decimal
 *   representation. So `pyRound(1.005, 2) === 1.0`, matching Python, because the double nearest
 *   1.005 is actually 1.00499999999999989.
 * - The two only disagree on an exact tie, where Python picks the even digit and `toFixed` picks the
 *   larger magnitude. An exact tie at 3 decimals needs the value to be exactly `k.xxx5`, i.e. a
 *   fraction with 5⁴ in its denominator. No binary double can represent that, so at `ndigits = 3`
 *   the tie case is unreachable and the two rules agree everywhere.
 *
 * That argument depends on `ndigits`, so the assertion below guards the range it holds for.
 * `toFixed` is also only valid below 1e21; confidence scores live in [0, 1].
 */
export function pyRound(value: number, ndigits: number): number {
  if (!Number.isInteger(ndigits) || ndigits < 1 || ndigits > 15) {
    throw new Error(`pyRound: ndigits must be an integer in [1, 15], got ${String(ndigits)}`);
  }
  return Number(value.toFixed(ndigits));
}
