/**
 * py.ts — counting and rounding primitives with Python semantics.
 *
 * Funder length limits are a submittable constraint, so counting has to be exact and has to agree
 * with the prototype that produced LaunchPad's filed applications. These five operations behave
 * differently in JS than the natural translation suggests. Each one removes a class of silent
 * defect rather than fixing an observed bug — see the note on {@link pyLen}.
 */

/**
 * Python's `str.split()` with no argument: splits on runs of whitespace, strips leading and
 * trailing whitespace, and returns `[]` for an all-whitespace string.
 *
 * The trap: `''.split(/\s+/)` is `['']` (length 1), so a naive port reports an empty answer as
 * 1 word.
 */
export function pySplit(text: string): string[] {
  const trimmed = text.trim();
  return trimmed === '' ? [] : trimmed.split(/\s+/);
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
  return [...text].length;
}

/**
 * Python's `str.rstrip()` — trailing whitespace only. `String.prototype.trim()` also strips the
 * leading side, which would corrupt a truncation preview.
 */
export function pyRstrip(text: string): string {
  return text.replace(/\s+$/, '');
}

/**
 * Sentence count: split on runs of `.!?` and keep the non-blank pieces.
 *
 * Deliberately a different rule from {@link pySplitSentences} — the prototype uses one pattern for
 * counting and another for truncating, and unifying them changes output.
 */
export function pyCountSentences(text: string): number {
  return text.split(/[.!?]+/).filter((s) => s.trim() !== '').length;
}

/**
 * Sentence split for truncation: lookbehind split that keeps terminal punctuation attached to the
 * sentence it ends.
 */
export function pySplitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
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
