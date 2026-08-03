/**
 * limits.ts — deterministic length measurement against a funder's stated limit.
 *
 * Why this is a tool and not left to the caller: a language model cannot reliably count its own
 * words or characters, and a grant that overruns a stated cap is rejected. Measurement has to be
 * the one thing in the loop that is arithmetic, not judgement.
 */

import { pyCountSentences, pyLen, pyRstrip, pySplit, pySplitSentences } from './py.js';
import type { Unit } from './schemas.js';

/**
 * Compression beyond this ratio is not compression — it is authoring a shorter answer, which means
 * choosing which facts to drop. That is an editorial decision a person has to make, so the tools
 * refuse to present it as a mechanical resize.
 *
 * The real case that motivates it: `cover.project_title` routes to `kb.program_desc`, 1403
 * characters, against Truist's 30-character cap — 46.8x. The correct answer is "LaunchPad".
 */
export const MAX_COMPRESSION_RATIO = 4;

export function countUnits(text: string, unit: Unit): number {
  switch (unit) {
    case 'words':
      return pySplit(text).length;
    case 'characters':
    case 'chars':
      return pyLen(text);
    case 'sentences':
      return pyCountSentences(text);
  }
}

/**
 * Hard truncation, for PREVIEW ONLY. This is never a usable answer — it exists so a reviewer can
 * see how far over the limit the stored text runs, and as a last-resort fallback a person can trim
 * by hand. Real shortening is a rewrite.
 *
 * Every branch marks the cut with `…`, and the contract is on the content *before* that marker: it
 * measures at or under `max` per {@link countUnits} — with one stated exception, the sentence case
 * where not even the first chunk fits. The marker itself is not content and is not
 * counted — under the sentence and word rules it would count as a unit of its own, so a preview that
 * re-measured within the cap *including* the marker would have to drop a real unit to make room for
 * punctuation. The `characters` branch reserves a slot for it because a character cap is the one case
 * where the marker's own width plausibly matters to a reviewer eyeballing the field.
 *
 * The sentence branch cannot simply slice: {@link pySplitSentences} breaks on terminal punctuation
 * followed by whitespace while {@link pyCountSentences} breaks on the punctuation alone. Any decimal
 * figure splits the two rules apart — `'Our FY2025 budget is $1.34M. We serve 145 young people.'` is
 * two chunks to the splitter and three sentences to the counter — and grant narrative is made of
 * decimal figures. Both rules come from the prototype and neither can move, so the branch keeps
 * chunks only while the counter still agrees the result fits; slicing to `max` chunks returned that
 * whole example as a two-sentence "preview" that re-measures as three.
 */
export function truncatePreview(text: string, unit: Unit, max: number): string {
  switch (unit) {
    case 'words':
      return `${pySplit(text).slice(0, max).join(' ')} …`;
    case 'characters':
    case 'chars':
      // eslint-disable-next-line @typescript-eslint/no-misused-spread -- must match pyLen's count
      return `${pyRstrip([...text].slice(0, Math.max(0, max - 1)).join(''))}…`;
    case 'sentences': {
      const chunks = pySplitSentences(text);
      const kept: string[] = [];
      for (const chunk of chunks) {
        if (kept.length > 0 && pyCountSentences([...kept, chunk].join(' ')) > max) break;
        kept.push(chunk);
      }
      // The first chunk is always kept, even when it alone counts as more than `max` sentences —
      // an empty preview tells a reviewer nothing. The marker still says it was cut.
      const preview = kept.join(' ');
      return kept.length === chunks.length ? preview : `${preview} …`;
    }
  }
}

export type FitVerdict = 'fits' | 'over_limit' | 'compression_infeasible';

export interface Measurement {
  /** Caller-supplied label, echoed so a batch result can be matched back to its field. */
  readonly label: string | null;
  readonly unit: Unit;
  readonly max: number;
  readonly count: number;
  readonly fits: boolean;
  /** Units over the cap; `0` when it fits. */
  readonly over_by: number;
  /** `count / max`, rounded to one decimal. How much compression the text needs. */
  readonly ratio: number;
  readonly verdict: FitVerdict;
  /** Present only when over the limit. Preview, never a submittable answer. */
  readonly truncated_preview?: string;
  readonly guidance: string;
}

export interface MeasureInput {
  readonly label?: string | undefined;
  readonly text: string;
  readonly unit: Unit;
  readonly max: number;
}

export function measure(input: MeasureInput): Measurement {
  const { text, unit, max } = input;
  // The seed schemas enforce `positive()`, but this is a public export and the tool layer is not the
  // only caller. `max: 0` would otherwise produce `ratio: Infinity` and guidance reading "(Infinityx)".
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`measure: max must be a positive integer number of ${unit}, got ${String(max)}`);
  }

  const count = countUnits(text, unit);
  const fits = count <= max;
  const overBy = fits ? 0 : count - max;
  const exactRatio = count / max;
  const ratio = Math.round(exactRatio * 10) / 10;

  // Verdict from the exact ratio, not the rounded one. At 4.04x the display rounds to 4.0, and
  // reading the verdict off that value called it `over_limit` with "cut the least-essential
  // supporting detail" guidance — for a text needing more than the 4x compression that
  // MAX_COMPRESSION_RATIO exists to refuse.
  const verdict: FitVerdict = fits
    ? 'fits'
    : exactRatio > MAX_COMPRESSION_RATIO
      ? 'compression_infeasible'
      : 'over_limit';

  const label = input.label ?? null;
  const base: Omit<Measurement, 'truncated_preview' | 'guidance'> = {
    label,
    unit,
    max,
    count,
    fits,
    over_by: overBy,
    ratio,
    verdict,
  };

  if (fits) {
    return { ...base, guidance: `Within the limit (${String(count)}/${String(max)} ${unit}).` };
  }

  const preview = truncatePreview(text, unit, max);

  if (verdict === 'compression_infeasible') {
    return {
      ...base,
      truncated_preview: preview,
      guidance:
        `Cannot compress ${String(count)} ${unit} to ${String(max)} ${unit} (${String(ratio)}x) without dropping ` +
        `facts. This is not a rewrite — it needs a purpose-written short answer. Check whether the ` +
        `question actually wants a short structured value rather than a narrative.`,
    };
  }

  return {
    ...base,
    truncated_preview: preview,
    guidance:
      `Over by ${String(overBy)} ${unit} (${String(count)}/${String(max)}, ${String(ratio)}x). Shorten by cutting the ` +
      `least-essential supporting detail. Do not alter, round, or approximate any figure you keep, ` +
      `and do not introduce anything not already in the source text.`,
  };
}

export interface BatchMeasurement {
  readonly items: readonly Measurement[];
  readonly all_fit: boolean;
  readonly over_count: number;
  readonly infeasible_count: number;
}

export function measureAll(inputs: readonly MeasureInput[]): BatchMeasurement {
  const items = inputs.map(measure);
  return {
    items,
    all_fit: items.every((i) => i.fits),
    over_count: items.filter((i) => !i.fits).length,
    infeasible_count: items.filter((i) => i.verdict === 'compression_infeasible').length,
  };
}
