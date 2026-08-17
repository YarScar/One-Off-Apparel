/**
 * warnings.ts — the two data-honesty warnings an action line may carry.
 *
 * Extracted from `pipeline.ts` at G4 so `resize.ts` can append the same strings rather than restating
 * them. That matters more than it sounds: the prototype's
 * `test_resized_answer_keeps_unverified_warning` exists because a shortened answer that quietly loses
 * its "not grounded in a filed application" marker reads to a reviewer as more trustworthy than the
 * text it came from. Two modules producing that marker from two string literals is how it goes
 * missing from one of them.
 *
 * Both warnings can apply at once and both are appended, because they say different things:
 * `verified: false` means the text was never grounded in a filed application, while `carriesFigures`
 * means the text states numbers that have since moved. A `verified: true` answer full of drifting
 * figures is the common case and the dangerous one.
 */

export const UNVERIFIED_SUFFIX =
  '  ⚠ Figures unverified — confirm with staff before submitting.';

export const FIGURES_SUFFIX =
  '  ⚠ Carries figures — verify every one against live data via the figure work order before ' +
  'publishing. The stored figures drift.';

/**
 * Append the warnings an action line needs.
 *
 * `verified: null` means the caller did not name a knowledge-base slot, so this layer cannot say
 * either way — it appends nothing rather than asserting the text is grounded. Silence is not a clean
 * bill of health, and `resize.ts` says so in its own action line.
 */
export function addWarnings(
  action: string,
  verified: boolean | null,
  carriesFigures: boolean,
): string {
  let out = action;
  if (verified === false) out += UNVERIFIED_SUFFIX;
  if (carriesFigures) out += FIGURES_SUFFIX;
  return out;
}
