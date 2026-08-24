/**
 * seq-ratio.ts — a faithful port of CPython `difflib.SequenceMatcher.ratio()`.
 *
 * `pipeline/matcher.py` scores every candidate with
 *
 *     SequenceMatcher(None, " ".join(a_tokens), " ".join(b_tokens)).ratio()
 *
 * blended 0.3 against a weighted Jaccard. TypeScript has no standard-library equivalent, and this
 * is the single largest technical risk in the port: a different result here changes **every** match
 * score, which changes which stored answer a funder question reaches. `admin/SPEC.md` section 5
 * makes proving this function gate G2.
 *
 * `ratio()` is not an edit-distance ratio. It is `2 * M / T`, where `M` is the total size of the
 * matching blocks found by a recursive longest-matching-block search and `T` is the combined length
 * of both sequences. Reproduce the algorithm, not an approximation of its output.
 *
 * ## Three traps, all of them live
 *
 * **1. Autojunk fires on the real bank.** When the second sequence reaches 200 characters,
 * `SequenceMatcher` treats any character occurring more than `len(b) // 100 + 1` times as
 * "popular" and drops it from the index. Measured over the bank's 322 unique candidate token-strings
 * (88 canonical + 248 variants, deduplicated), six cross that threshold at bank v0.4.1:
 *
 * | Question id                    | Variant source  | Normalized length |
 * |--------------------------------|-----------------|-------------------|
 * | `program.description`          | `GSK-STEM-2026` | 201               |
 * | `program.equitable_access`     | `GEPA-427`      | 210               |
 * | `program.partnerships`         | `PAsmart`       | 215               |
 * | `organization.why_this_funder` | `Hamilton-2025` | 221               |
 * | `organization.history`         | `JEVS-C2L`      | 244               |
 * | `program.description`          | `WPF-2026`      | 352               |
 *
 * All six are variants rather than canonical phrasings — the heuristic fires exactly where funder
 * wording runs longest. Skipping it would silently mis-score them. Do not maintain this table by
 * hand: `seq-ratio.test.ts` derives the set from the live bank and fails if the parity fixture has
 * not been regenerated for it.
 *
 * **2. The function is asymmetric.** Autojunk is computed over `b` alone, so `ratio(x, y)` and
 * `ratio(y, x)` differ for those six rows. In `matcher.py`, `a` is the *incoming* question and
 * `b` is the *candidate*. Do not swap them.
 *
 * **3. Popular characters are dropped from the index but are not junk.** CPython keeps `bpopular`
 * and `bjunk` as separate sets, and only `bjunk` blocks the match-extension loops in
 * `find_longest_match`. So an autojunked character cannot *start* a match but can still be absorbed
 * into one that a neighbouring character started. Treating popular characters as junk would be the
 * obvious simplification and it would be wrong.
 *
 * Because `isjunk` is `None` at the only call site, `bjunk` is always empty. The two junk-extension
 * loops CPython runs after the non-junk ones are therefore unreachable here, and are omitted with a
 * note at the call site rather than ported as dead code.
 */

import { pyLen } from './py.js';

/** `b` must reach this length before the autojunk heuristic applies at all. */
export const AUTOJUNK_MIN_LENGTH = 200;

/** One matching block: `a[aStart .. aStart+size)` equals `b[bStart .. bStart+size)`. */
export interface MatchingBlock {
  readonly aStart: number;
  readonly bStart: number;
  readonly size: number;
}

const NO_INDICES: readonly number[] = [];

/**
 * Build CPython's `b2j` index — character to ascending positions in `b` — and apply autojunk.
 *
 * Returns the dropped characters as well, purely so tests and callers can assert that the
 * heuristic fired where it is expected to. They are deliberately *not* treated as junk; see trap 3
 * in the module header.
 */
function chainB(b: readonly string[]): {
  readonly b2j: Map<string, number[]>;
  readonly popular: ReadonlySet<string>;
} {
  const b2j = new Map<string, number[]>();
  for (let i = 0; i < b.length; i += 1) {
    const elt = b[i];
    if (elt === undefined) continue;
    const indices = b2j.get(elt);
    if (indices === undefined) b2j.set(elt, [i]);
    else indices.push(i);
  }

  const popular = new Set<string>();
  const n = b.length;
  if (n >= AUTOJUNK_MIN_LENGTH) {
    // CPython: ntest = n // 100 + 1, then drop where len(idxs) > ntest.
    const ntest = Math.floor(n / 100) + 1;
    for (const [elt, indices] of b2j) {
      if (indices.length > ntest) popular.add(elt);
    }
    for (const elt of popular) b2j.delete(elt);
  }

  return { b2j, popular };
}

/**
 * CPython `find_longest_match` over `a[alo, ahi)` and `b[blo, bhi)`.
 *
 * Ties break to the earliest `i`, then the earliest `j`, which falls out of scanning `i` ascending
 * and requiring a strict `k > bestsize` to displace the incumbent.
 */
function findLongestMatch(
  a: readonly string[],
  b: readonly string[],
  b2j: ReadonlyMap<string, number[]>,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
): MatchingBlock {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;

  // j2len[j] is the length of the run ending at b[j] for the previous i. Rebuilt each row, so a
  // run only survives while it keeps extending.
  let j2len = new Map<number, number>();

  for (let i = alo; i < ahi; i += 1) {
    const newj2len = new Map<number, number>();
    const elt = a[i];
    const indices = elt === undefined ? NO_INDICES : (b2j.get(elt) ?? NO_INDICES);
    for (const j of indices) {
      if (j < blo) continue;
      if (j >= bhi) break; // indices ascend, so nothing further can qualify
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newj2len.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = newj2len;
  }

  // Extend across characters that autojunk removed from the index. This is what keeps a popular
  // character from acting like junk — trap 3 in the module header.
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti -= 1;
    bestj -= 1;
    bestsize += 1;
  }
  while (
    besti + bestsize < ahi &&
    bestj + bestsize < bhi &&
    a[besti + bestsize] === b[bestj + bestsize]
  ) {
    bestsize += 1;
  }

  // CPython follows these with two more loops that absorb matching *junk* on each side. `isjunk` is
  // None at our only call site, so `bjunk` is empty and both loops are unreachable. Omitted rather
  // than ported as dead code; restore them alongside an `isjunk` parameter if one is ever needed.

  return { aStart: besti, bStart: bestj, size: bestsize };
}

/**
 * CPython `get_matching_blocks`, minus the trailing sentinel and the adjacent-block collapse.
 *
 * Both omissions are safe for `ratio()`: the sentinel has size 0, and collapsing adjacent blocks
 * preserves their total size. Blocks come back in the queue's discovery order, not sorted.
 */
export function matchingBlocks(a: string, b: string): readonly MatchingBlock[] {
  // Code points, not UTF-16 units: CPython iterates `str` by code point, and G2 parity is
  // asserted exactly. Grapheme segmentation would diverge from difflib.
  /* eslint-disable-next-line @typescript-eslint/no-misused-spread -- see above */
  const ax = [...a];
  /* eslint-disable-next-line @typescript-eslint/no-misused-spread -- see above */
  const bx = [...b];
  const { b2j } = chainB(bx);

  const blocks: MatchingBlock[] = [];
  const queue: Array<readonly [number, number, number, number]> = [[0, ax.length, 0, bx.length]];
  while (queue.length > 0) {
    const region = queue.pop();
    if (region === undefined) break;
    const [alo, ahi, blo, bhi] = region;
    const block = findLongestMatch(ax, bx, b2j, alo, ahi, blo, bhi);
    const { aStart: i, bStart: j, size: k } = block;
    if (k > 0) {
      blocks.push(block);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return blocks;
}

/**
 * `difflib.SequenceMatcher(None, a, b).ratio()` — a similarity in [0, 1].
 *
 * Asymmetric: `b` is the sequence autojunk is computed over. Pass the incoming question as `a` and
 * the candidate as `b`, matching `matcher.py`.
 *
 * Two empty strings score 1.0, as in CPython, where `_calculate_ratio` returns 1.0 for a zero
 * total length.
 */
export function sequenceRatio(a: string, b: string): number {
  const total = pyLen(a) + pyLen(b);
  if (total === 0) return 1.0;
  let matches = 0;
  for (const block of matchingBlocks(a, b)) matches += block.size;
  return (2.0 * matches) / total;
}

/**
 * The characters autojunk removed from the index for `b`, exposed so callers and tests can confirm
 * the heuristic fired. Empty whenever `b` is shorter than {@link AUTOJUNK_MIN_LENGTH}.
 */
export function autojunkedCharacters(b: string): ReadonlySet<string> {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code points, as CPython does
  return chainB([...b]).popular;
}
