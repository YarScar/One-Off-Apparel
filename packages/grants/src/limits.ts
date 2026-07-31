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
 */
export function truncatePreview(text: string, unit: Unit, max: number): string {
  switch (unit) {
    case 'words':
      return `${pySplit(text).slice(0, max).join(' ')} …`;
    case 'characters':
    case 'chars':
      // eslint-disable-next-line @typescript-eslint/no-misused-spread -- must match pyLen's count
      return `${pyRstrip([...text].slice(0, Math.max(0, max - 1)).join(''))}…`;
    case 'sentences':
      return pySplitSentences(text).slice(0, max).join(' ');
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
  const count = countUnits(text, unit);
  const fits = count <= max;
  const overBy = fits ? 0 : count - max;
  const ratio = Math.round((count / max) * 10) / 10;

  const verdict: FitVerdict = fits
    ? 'fits'
    : ratio > MAX_COMPRESSION_RATIO
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
