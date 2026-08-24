/**
 * handback.ts — what this layer gives back to the calling model when text needs shaping.
 *
 * ## Why this module exists
 *
 * The knowledge base exists so a model does not regenerate answers LaunchPad has already written and
 * approved. It is an *assist*, not a gate. So when a stored answer does not drop straight into a
 * funder's field — it runs past the limit, or the field wants a short value and the slot holds
 * narrative — the right move is to hand the material back to the calling model with the limit, the
 * measurement, and the rules it must respect. Not to refuse, and not to escalate to a person.
 *
 * **There is no Claude call anywhere in this layer.** `TAD.md` §6 decision 6 records why: an MCP tool
 * is invoked *by* Claude, so a tool that opened its own model client would be solving the wrong
 * problem. `@anthropic-ai/sdk` appears in no `package.json` here. The tool returns the source text,
 * the limit, the measurement, and the instructions; the calling model rewrites and calls back to
 * re-measure. That keeps the whole layer deterministic and unit-testable with no mocking.
 *
 * ## Why it is shared
 *
 * `grant_build_draft` (G3) produces handbacks for over-limit and derive-a-value cases.
 * `grant_resize_answer` (G4) produces one for a single answer on demand. Both must state the same
 * rules, because a model that gets a stricter guardrail from one tool than the other will produce
 * inconsistent drafts. Building the payload once here is what keeps them from drifting.
 *
 * {@link RESIZE_RULES} is the prototype's `resize.py::_SYSTEM_PROMPT`, carried over as
 * `admin/SPEC.md` §2.2 requires. {@link buildHandback}'s context assembly is its `_build_user_prompt`.
 * Do not soften either one: the no-invention rule is the guardrail that makes a generated grant
 * answer safe to put in front of a funder at all.
 */

import type { Measurement } from './limits.js';
import type { FormLimit } from './schemas.js';
import type { SlotRequirement } from './slots.js';

/**
 * The absolute rules for shortening a stored answer. Ported from the prototype's `_SYSTEM_PROMPT`,
 * which produced LaunchPad's filed applications.
 *
 * Phrased as discrete rules rather than one prose block so a caller can render them as a checklist
 * and so a test can assert the no-invention rule is present rather than fuzzy-matching a paragraph.
 */
export const RESIZE_RULES: readonly string[] = [
  'NEVER invent, add, infer, or embellish any fact, figure, statistic, name, date, program detail, ' +
    'or outcome. Use ONLY what appears in the source answer.',
  'If everything cannot fit, DROP the least-essential supporting detail. Do not alter, round, or ' +
    'approximate any figure you keep.',
  "Preserve the organization's voice and the concrete specifics that make the answer credible " +
    '(named programs, real numbers, populations served).',
  'Do not add a preamble, a title, quotation marks, meta-commentary, or a word/character count. ' +
    'Return ONLY the rewritten answer text, nothing else.',
];

/**
 * The rules for pulling a short structured value out of narrative source material.
 *
 * A different task from resizing, and a stricter one. Resizing compresses prose that already answers
 * the question; this reads prose that answers a *broader* question and extracts one value from it —
 * an organization name, an EIN, a yes or no. The failure mode is inventing the value when the source
 * does not actually contain it, so the last rule is the load-bearing one.
 */
export const DERIVE_RULES: readonly string[] = [
  'Answer with the short value the field asks for and nothing else — no narrative, no preamble, no ' +
    'explanation.',
  'Take the value ONLY from the source material below. Do not invent, infer, or complete it from ' +
    'outside knowledge, and do not guess at a plausible value.',
  'Do not alter, round, or reformat a figure, name, or date you take from the source.',
  'If the source material does not contain the value, say so explicitly and flag the field for ' +
    'staff. An invented value is worse than an unanswered field.',
];

/**
 * The rules for writing a full answer around a confirmed short value.
 *
 * **This is the most dangerous task in the layer, and these rules are written accordingly.** The
 * other two constrain a model that has too much material: resizing chooses what to drop, deriving
 * picks one value out of prose. This one hands a model a 9-word fact, 200 words of empty field, and
 * a slot of source material — and the obvious way to fill that space is to make something up. Every
 * invented statistic in a grant application starts exactly here.
 *
 * Two rules carry the weight and neither is obvious:
 *
 * 1. **The limit is a ceiling, not a target.** A guard that provoked padding would be worse than the
 *    defect it was added to fix, because a short accurate answer is a good answer and a long invented
 *    one ends a funder relationship. The rule says so in those words.
 * 2. **The confirmed value survives verbatim.** It is the one part of the answer already checked
 *    against filed material. An expansion that paraphrases it has quietly replaced a verified fact
 *    with an unverified one while looking like it did the work.
 */
export const EXPAND_RULES: readonly string[] = [
  'The confirmed value MUST appear in your answer unchanged — same figures, same names, same ' +
    'wording. It is the part of this answer that has already been checked. Build around it; do not ' +
    'restate it in your own words.',
  'NEVER invent, add, infer, or embellish any fact, figure, statistic, name, date, program detail, ' +
    'or outcome. Everything you add must come from the source material below.',
  'The limit is a CEILING, NOT A TARGET. Do not pad to reach it. If the confirmed value and the ' +
    'source material only support three sentences, write three sentences — a short accurate answer ' +
    'is a good answer, and a padded one is how invented facts reach a funder.',
  'If the source material does not cover what the field is asking for, write what it does support ' +
    'and say plainly what is missing, so staff can fill the gap. Do not paper over it.',
  'Do not add a preamble, a title, quotation marks, meta-commentary, or a word/character count. ' +
    'Return ONLY the answer text, nothing else.',
];

/**
 * {@link EXPAND_RULES} for the expansion that has no confirmed value to build around.
 *
 * The narrative path underfills a field with the slot's own prose — there is no separately verified
 * short value, so {@link EXPAND_RULES}' first rule has no referent, and stating it anyway invites a
 * model to invent the "confirmed value" it is told must appear verbatim. The remaining four rules are
 * the ones that matter here, and the ceiling-not-a-target rule most of all: this task hands a model a
 * thin slot and a large empty field, which is the shape that produces invented statistics.
 *
 * Identical to `EXPAND_RULES` minus the anchor rule, expressed by reference so the two cannot drift.
 */
export const EXPAND_RULES_NO_ANCHOR: readonly string[] = EXPAND_RULES.slice(1);

/**
 * The rules for filling live figures into slotted stored prose.
 *
 * The task `slots.ts` exists to create: stored text carries `{{slot}}` tokens where a figure belongs,
 * and this is the instruction set for turning that template into an answer. It is the narrowest task in
 * the layer and the rules are correspondingly absolute — there is exactly one acceptable source for
 * each number, and it is the call named in the requirement.
 *
 * The load-bearing rule is the last one. A model that cannot fill a slot has two options that both look
 * like progress: write a plausible number, or quietly delete the clause. Both defeat the mechanism, and
 * the second is worse because it leaves no evidence. Saying so explicitly is the only thing standing
 * between an unfillable slot and a silently shortened answer.
 */
export const FILL_FIGURE_RULES: readonly string[] = [
  'Replace each {{slot}} with the figure returned by the call named for that slot, and nothing else. ' +
    'One slot, one figure, from that call.',
  'Do NOT write a figure from any other source — not from memory, not from another slot, not from ' +
    'prose elsewhere in this draft, and not from the funder’s own materials.',
  'Do not round, reformat, or "tidy" a returned figure. If a call returns 362030.26, the sentence ' +
    'says $362,030.26 unless the surrounding prose established a different precision.',
  'Leave every word outside the slots exactly as written. This text is approved language; you are ' +
    'filling holes in it, not rewriting it.',
  'CHECK THE CUT BEFORE YOU WRITE THE NUMBER. Each slot states the `population` its call returns. If ' +
    'the question asked about a different population — a single year where the call is all-time, one ' +
    'phase where the call is every phase, one cohort where the call pools them — then this stored ' +
    'sentence does not answer the question, and filling it with a differently-cut figure produces a ' +
    'false sentence containing a true number. Say the stored answer does not cover the ask. Do not ' +
    'substitute a different cut, and do not reword the sentence to make the cut you have fit.',
  'State the population in the same sentence as the figure wherever the prose does not already. "301 ' +
    'participants" is not an answer; "301 enrollment records across all phases and all time" is.',
  'Where a slot is marked as needing a staff decision, run the call and then STOP on that slot. Report ' +
    'both the number and the question it depends on. Do not pick a population, a denominator, or an ' +
    'as-of date yourself.',
  'If a call fails, is denied by your role, or returns nothing that answers the slot, leave the slot ' +
    'token in place and say which slot could not be filled. Do NOT invent a figure and do NOT delete ' +
    'the sentence to make the gap disappear — an unfilled slot is a visible gap a person can close, ' +
    'and a deleted clause is not.',
];

export type HandbackTask = 'resize' | 'derive_short_value' | 'expand' | 'fill_figures';

/**
 * Context that shapes the rewrite without licensing new content. Mirrors the prototype's
 * `_build_user_prompt` assembly: the funder, the emphasis to preserve, and what the stored answer
 * is an answer to.
 */
export interface HandbackContext {
  readonly funder: string | null;
  /** The funder "hat" — emphasis to keep if it is already present. Never a licence to add. */
  readonly emphasis: string | null;
  /** The knowledge-base label, so the model knows what the source text is an answer to. */
  readonly answers: string | null;
}

/**
 * Everything the calling model needs to do one piece of shaping work, and nothing else.
 *
 * `measurement` is `null` only on a `derive_short_value` task with no stated limit — there is nothing
 * to measure against. On a `resize` task it is always present, because the limit is what triggered it.
 */
export interface Handback {
  readonly task: HandbackTask;
  /** One line naming the work, for a caller that renders rather than reasons. */
  readonly instruction: string;
  readonly source_text: string;
  readonly limit: FormLimit | null;
  readonly measurement: Measurement | null;
  readonly context: HandbackContext;
  readonly rules: readonly string[];
  /** Then re-measure. Shaped text is never final until the arithmetic agrees. */
  readonly verify_with: string;
  /**
   * Present only on an `expand` task: the confirmed short value the expansion is built around, which
   * must survive into the answer verbatim.
   *
   * Structural rather than folded into `source_text` on purpose. The two are different kinds of
   * material — this one is checked and must be preserved, the source is context that may be used —
   * and a caller that concatenated them would lose the distinction the rules depend on.
   */
  readonly anchor_value?: string;
  /**
   * Present only on a `fill_figures` task: every slot in `source_text`, with the call that fills it.
   *
   * Structural rather than left for the caller to parse out of the text, for the same reason
   * {@link Handback.anchor_value} is: a caller that had to re-derive the requirement from `{{tokens}}`
   * would need its own copy of `FIGURE_SLOTS`, and the copy would drift.
   */
  readonly figure_slots?: readonly SlotRequirement[];
}

/**
 * Names `grant_resize_answer` as of G4, which registered it. Until then this named
 * `grant_build_draft`, because pointing a caller at a tool absent from `tools/list` produces a failed
 * call and a model that improvises around it — the check is registration, not intent.
 *
 * `grant_resize_answer` is the right target now that it exists: it takes one answer and one limit,
 * which is the shape of the work a handback describes. `grant_build_draft` takes a whole form and has
 * no parameter for a rewritten answer, so the old wording asked for something it could not accept.
 */
const VERIFY =
  'Re-measure the result before using it — pass the rewritten text back to grant_resize_answer as ' +
  '`rewrite`, with the same `text` and `limit`. A length claim is only true if the arithmetic says ' +
  'so; do not count words or characters yourself. That call also checks every figure in your rewrite ' +
  'against the source and rejects one the source does not state.';

export interface BuildHandbackInput {
  readonly task: HandbackTask;
  readonly sourceText: string;
  readonly limit: FormLimit | null;
  readonly measurement: Measurement | null;
  readonly context: HandbackContext;
  /** Prepended to the standard rules — for the case where dropping facts is unavoidable. */
  readonly extraRules?: readonly string[];
  /** Required on an `expand` task, ignored otherwise. See {@link Handback.anchor_value}. */
  readonly anchorValue?: string;
  /** Required on a `fill_figures` task, ignored otherwise. See {@link Handback.figure_slots}. */
  readonly figureSlots?: readonly SlotRequirement[];
}

const RULES_FOR_TASK: Readonly<Record<HandbackTask, readonly string[]>> = {
  resize: RESIZE_RULES,
  derive_short_value: DERIVE_RULES,
  expand: EXPAND_RULES,
  fill_figures: FILL_FIGURE_RULES,
};

function instructionFor(task: HandbackTask, limit: FormLimit | null, anchor: string | undefined): string {
  switch (task) {
    case 'fill_figures':
      // No limit in this instruction on purpose. Filling a slot changes the length by a few
      // characters, and pointing a model at a word count while it is substituting figures invites it
      // to trim the approved prose to compensate — which rule 4 forbids. Length is re-measured
      // afterwards, by `grant_resize_answer`, which is where it belongs.
      return (
        'The stored answer below is approved language with the figures removed. Fill every {{slot}} ' +
        'from the call named for it in `figure_slots`, change nothing else, and report any slot you ' +
        'could not fill.'
      );
    case 'resize':
      return `Rewrite the source text below to fit ${describeLimit(limit)}, following every rule.`;
    case 'derive_short_value':
      return `Give the short value this field asks for, taken from the source material below${
        limit === null ? '' : `, within ${describeLimit(limit)}`
      }.`;
    case 'expand':
      // Two shapes, because the anchored and unanchored expansions are different tasks. With an
      // anchor there is a checked value to build around; without one — the narrative path, where the
      // slot's own prose underfills the field — the work is writing the fuller answer from that prose,
      // and telling a model to preserve a "confirmed value" that does not exist invites it to invent
      // one.
      return anchor === undefined
        ? `The stored answer fills only a fraction of this field. Write the fuller answer from the ` +
            `source material below, drawing ONLY on it${
              limit === null ? '' : `, up to ${describeLimit(limit)}`
            }. Use less if that is all the material supports, and say what is missing rather than ` +
            `padding.`
        : `This field has room for more than the confirmed value (“${anchor}”) answers on its own. ` +
            `Write the full answer around that value, drawing ONLY on the source material below${
              limit === null ? '' : `, up to ${describeLimit(limit)}`
            }. Use less if that is all the material supports.`;
  }
}

export function buildHandback(input: BuildHandbackInput): Handback {
  const { task, sourceText, limit, measurement, context, anchorValue } = input;
  const rules =
    task === 'expand' && anchorValue === undefined
      ? EXPAND_RULES_NO_ANCHOR
      : RULES_FOR_TASK[task];
  return {
    task,
    instruction: instructionFor(task, limit, anchorValue),
    source_text: sourceText,
    limit,
    measurement,
    context,
    rules: [...(input.extraRules ?? []), ...rules],
    verify_with: VERIFY,
    ...(task === 'expand' && anchorValue !== undefined ? { anchor_value: anchorValue } : {}),
    ...(task === 'fill_figures' && input.figureSlots !== undefined
      ? { figure_slots: input.figureSlots }
      : {}),
  };
}

function describeLimit(limit: FormLimit | null): string {
  return limit === null ? 'the funder’s field' : `${String(limit.max)} ${limit.unit}`;
}
