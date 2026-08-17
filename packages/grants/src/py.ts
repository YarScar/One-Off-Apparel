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
 * Python rounds half-to-even, on the *exact binary value* of the double rather than its shortest
 * decimal form. That second half is why `pyRound(1.005, 2) === 1.0` — the double nearest 1.005 is
 * 1.00499999999999989, which is not a tie at all.
 *
 * This used to be `Number(value.toFixed(ndigits))`, on the argument that an exact tie at
 * `ndigits = 3` needs a denominator of 5⁴ and no binary double can represent that, so half-up and
 * half-even could never disagree. **That argument was inverted and the conclusion is false.** A tie
 * needs 5⁴ to divide the *numerator* of `n / 10⁴`, which is exactly what makes it representable:
 * 0.0625, 0.1875, … 0.9375 are all exact ties at 3 decimals, and CPython disagrees with `toFixed`
 * on four of the eight — `round(0.0625, 3) == 0.062` against `(0.0625).toFixed(3) === '0.063'`.
 *
 * The score is `0.7 * jaccard + 0.3 * sequenceRatio`, so landing on one of those eight is remote
 * rather than impossible, and "remote" is not a parity contract. So the rule is implemented instead
 * of argued: decompose the double into `m · 2^e` exactly, compare the remainder against half the
 * divisor in `BigInt`, and break an exact tie to the even quotient. The result is assembled as a
 * decimal string so the final `Number` conversion lands on the nearest double to the rounded
 * decimal — the same value Python returns.
 *
 * `ndigits` is still range-guarded: at least 1 because the assembly below writes a fraction part,
 * and at most 15 because past that the digits are noise for the [0, 1] scores this serves.
 */
export function pyRound(value: number, ndigits: number): number {
  if (!Number.isInteger(ndigits) || ndigits < 1 || ndigits > 15) {
    throw new Error(`pyRound: ndigits must be an integer in [1, 15], got ${String(ndigits)}`);
  }
  if (!Number.isFinite(value)) return value;

  const negative = value < 0 || Object.is(value, -0);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biasedExponent = (hi >>> 20) & 0x7ff;
  const fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);

  // |value| === mantissa · 2^exponent, exactly. Subnormals have no implicit leading bit.
  const mantissa = biasedExponent === 0 ? fraction : fraction | (1n << 52n);
  const exponent = BigInt(biasedExponent === 0 ? -1074 : biasedExponent - 1075);

  const scale = 10n ** BigInt(ndigits);
  const positiveExponent = exponent >= 0n;
  const numerator = mantissa * scale * (positiveExponent ? 1n << exponent : 1n);
  const denominator = positiveExponent ? 1n : 1n << -exponent;

  let quotient = numerator / denominator;
  const doubledRemainder = (numerator % denominator) * 2n;
  if (doubledRemainder > denominator || (doubledRemainder === denominator && quotient % 2n === 1n)) {
    quotient += 1n;
  }

  const digits = quotient.toString().padStart(ndigits + 1, '0');
  const whole = digits.slice(0, digits.length - ndigits);
  const decimals = digits.slice(digits.length - ndigits);
  return Number(`${negative ? '-' : ''}${whole}.${decimals}`);
}
