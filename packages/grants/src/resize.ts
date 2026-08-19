/**
 * resize.ts — shorten one stored answer to one funder's stated limit, deterministically.
 *
 * A re-expression of the prototype's `pipeline/resize.py`, and the one module where the re-expression
 * changes the architecture rather than the language.
 *
 * ## Why there is no model call here
 *
 * The prototype's `ClaudeResizer` opens an Anthropic client, sends `_SYSTEM_PROMPT` plus an assembled
 * user prompt, re-counts the reply, and retries once with overflow feedback. That design is right for
 * a Python CLI, which has no model in the loop. It is wrong for an MCP tool, which is invoked *by*
 * Claude — `admin/TAD.md` §5 decision 6 and `admin/SPEC.md` §2.2 both settle this. So the loop turns
 * inside out:
 *
 * ```
 *   prototype:  build_answer → resizer(text, limit, ctx) → ResizeResult   [in-process, networked]
 *   here:       caller → grant_resize_answer(text, limit) → handback
 *               caller rewrites
 *               caller → grant_resize_answer(text, limit, rewrite) → verdict
 * ```
 *
 * `MAX_ATTEMPTS`, `make_resizer`, `DEFAULT_MODEL`, and the retry loop do not port — they are the
 * inside of a call this layer no longer makes. What ports is everything that was *around* that call:
 * the `_SYSTEM_PROMPT` guardrail (now {@link RESIZE_RULES} in `handback.ts`), `_build_user_prompt`'s
 * context assembly (now {@link buildHandback}), the unit re-measurement, the overflow feedback text,
 * and the {@link ResizeResult} field set. {@link ResizeResult.model} is kept and is always `null`,
 * exactly as the prototype documented it for a non-LLM resizer: "used for provenance in reports".
 *
 * ## Beyond the prototype, on purpose
 *
 * {@link ResizeResult.figure_check} has no prototype counterpart. The prototype re-measures *length*
 * and takes the model's word on everything else, so a rewrite that trimmed 40 words and moved a
 * dollar figure by a digit came back marked `fits`. The first of {@link RESIZE_RULES} calls exactly
 * that output unusable, and a rule nothing checks is a suggestion. Comparing the numeric claims in
 * the rewrite against those in the source is arithmetic, which makes it this layer's job rather than
 * the caller's — the same reason length measurement lives here. Dropping a figure stays allowed;
 * rule 2 licenses it. Introducing one does not.
 *
 * Nothing here is submittable. A person reviews and a person submits — `admin/PROPOSAL.md` §1.
 */

import { loadKnowledgeBase } from './data.js';
import { extractNumericClaims } from './figures.js';
import { buildHandback, type Handback, type HandbackContext } from './handback.js';
import { MAX_COMPRESSION_RATIO, measure, type Measurement } from './limits.js';
import type { FormLimit } from './schemas.js';
import { needsManualFigureCheck, slotsIn } from './slots.js';
import { addWarnings } from './warnings.js';

/**
 * The outcome of one call, named for the prototype's `ResizeResult.notes` so the two are legible side
 * by side. `fits` and `still_over_limit` are the prototype's own values.
 */
export type ResizeNote =
  /** Nothing is owed. Either the source already fits, or a rewrite came back fitting and faithful. */
  | 'fits'
  /** Over the limit. The handback carries the source, the limit, the measurement, and the rules. */
  | 'rewrite_owed'
  /** Over by more than {@link MAX_COMPRESSION_RATIO}. Still handed back, with facts-will-drop stated. */
  | 'compression_infeasible'
  /** A rewrite came back and is still over. The handback carries the overflow feedback. */
  | 'still_over_limit'
  /** A rewrite states a figure its source does not. Not acceptable at any length. */
  | 'figures_altered'
  /**
   * A rewrite came back empty or whitespace only. Not a prototype value — the prototype never saw a
   * rewrite it had not just generated itself, and an MCP caller can send one. Distinct from
   * `rewrite_owed` so the caller learns its rewrite was discarded rather than never noticed.
   */
  | 'rewrite_empty'
  /**
   * The source text carries figure slots and the rewrite lost one. Not acceptable at any length, and
   * for the same reason `figures_altered` is not: a slot that vanishes during a rewrite removes the
   * only thing that was going to force the live lookup. The difference is that a dropped *figure* is
   * allowed — rule 2 licenses it — and a dropped *slot* is not, because it takes the requirement with
   * it rather than just the detail.
   */
  | 'slots_dropped';

/** What the caller may tell this module about where the text came from. Every field is optional. */
export interface ResizeContextInput {
  /** The funder, so the rewrite keeps the right register. */
  readonly funder?: string | undefined;
  /** The funder "hat" — emphasis to preserve *if already present*. Never a licence to add. */
  readonly emphasis?: string | undefined;
  /**
   * The knowledge-base slot the source text came from. Supplying it is what lets this module read the
   * slot's own `verified` flag and label rather than taking the caller's word for either.
   */
  readonly kbRef?: string | undefined;
  /** What the source text is an answer to. Overridden by the slot's label when `kbRef` resolves. */
  readonly answers?: string | undefined;
}

export interface ResizeInput {
  /** The source answer, as stored. On a verify call this stays the ORIGINAL, not the rewrite. */
  readonly text: string;
  readonly limit: FormLimit;
  /** A rewrite to check. Absent on the first call; present on every re-measure. */
  readonly rewrite?: string | undefined;
  /** 1-based, for the trace and the feedback line. Defaults to the number of texts seen. */
  readonly attempt?: number | undefined;
  readonly context?: ResizeContextInput | undefined;
}

/** Which numeric claims moved between the source and a rewrite. */
export interface FigureFidelityCheck {
  /** No figure in the rewrite is absent from the source. Dropping is allowed; inventing is not. */
  readonly ok: boolean;
  readonly source_figures: readonly string[];
  readonly rewrite_figures: readonly string[];
  /** In the rewrite, not in the source. Any entry here is a rule-1 violation. */
  readonly invented: readonly string[];
  /** In the source, not in the rewrite. Allowed — rule 2 permits dropping detail. Reported anyway. */
  readonly dropped: readonly string[];
}

/**
 * The prototype's `ResizeResult`, widened to carry what `build_answer` used to hold on its behalf.
 *
 * `text`, `model`, `attempts`, `notes`, and `trace` are the prototype's fields. `fits_after_resize`,
 * `units_before`, `units_after`, `answer_full`, and `answer_truncated_preview` are the fields
 * `pipeline.py::build_answer` set around a resizer call — they move here because the call moved out of
 * process, and the prototype's five `ResizeHookTests` cases assert on them.
 */
export interface ResizeResult {
  readonly notes: ResizeNote;
  /**
   * True only when a rewrite both fits and altered no figure. The single field a caller can branch on
   * without re-deriving the verdict — and the reason `fits_after_resize` alone is not enough.
   */
  readonly accepted: boolean;
  /** The accepted rewrite. `null` whenever a rewrite is still owed or was rejected. */
  readonly text: string | null;
  /**
   * Kept from the prototype's `ResizeResult`, where it named the model that did the rewrite and was
   * documented as `None` for a non-LLM resizer. Always `null` here: no model, no SDK, no network.
   */
  readonly model: null;
  readonly attempts: number;
  /** The source answer, always echoed, so a rejected rewrite does not lose the text it came from. */
  readonly answer_full: string;
  /** Hard truncation of the source. Preview only — never a submittable answer. */
  readonly answer_truncated_preview: string | null;
  readonly units_before: number;
  /** Units in the rewrite. `null` on the first call, where there is no rewrite yet. */
  readonly units_after: number | null;
  /** `null` on the first call. Length only — see {@link accepted} before using a rewrite. */
  readonly fits_after_resize: boolean | null;
  /** Of the rewrite when there is one, of the source otherwise. */
  readonly measurement: Measurement;
  /** Of the source, always, so the compression actually achieved stays visible. */
  readonly source_measurement: Measurement;
  /** The work owed to the caller. `null` exactly when nothing is owed. */
  readonly handback: Handback | null;
  /** What to do next, in one sentence, carrying the data-honesty warnings. Never empty. */
  readonly action: string;
  readonly trace: readonly string[];
  /** Echoed from the context, and the parity hook for `test_resizer_receives_context`. */
  readonly kb_ref: string | null;
  /** The slot's own "grounded in a filed application" flag. `null` when no slot was named. */
  readonly verified: boolean | null;
  /** Whether the *source* states figures needing live verification. */
  readonly carries_figures: boolean;
  /** `null` on the first call — there is no rewrite to compare yet. */
  readonly figure_check: FigureFidelityCheck | null;
}

/**
 * Measure one answer against one limit, and say what is owed.
 *
 * Called twice per rewrite in the normal flow: once without `rewrite` to get the handback, once with
 * it to check the result. Both calls are pure — the same input always gives the same output, and
 * neither touches the network, a model, or the database.
 */
export function resizeAnswer(input: ResizeInput): ResizeResult {
  const { text, limit } = input;
  const ctx = input.context ?? {};

  // The slot is the authority on its own `verified` flag, so it is read rather than accepted from the
  // caller. A caller that could assert `verified: true` could strip the unverified warning off an
  // answer that never earned it, which is the one thing that warning exists to prevent.
  const slot = ctx.kbRef === undefined ? undefined : loadKnowledgeBase().answers[ctx.kbRef];
  const kbRef = ctx.kbRef ?? null;
  const verified = slot?.verified ?? null;
  // Same change as `pipeline.ts`: a figure needing a hand check, not "contains two digits".
  const carriesFigures = needsManualFigureCheck(text);

  const handbackContext: HandbackContext = {
    funder: ctx.funder ?? null,
    emphasis: ctx.emphasis ?? null,
    answers: slot?.label ?? ctx.answers ?? null,
  };

  const sourceMeasurement = measure({
    ...(kbRef === null ? {} : { label: kbRef }),
    text,
    unit: limit.unit,
    max: limit.max,
  });
  const unitsBefore = sourceMeasurement.count;
  const preview = sourceMeasurement.truncated_preview ?? null;

  const base = {
    model: null,
    answer_full: text,
    answer_truncated_preview: preview,
    units_before: unitsBefore,
    source_measurement: sourceMeasurement,
    kb_ref: kbRef,
    verified,
    carries_figures: carriesFigures,
  } as const;

  // ------------------------------------------------------------------ the first call: no rewrite yet
  if (input.rewrite === undefined) {
    const attempts = input.attempt ?? 1;
    const trace = [`source: ${String(unitsBefore)}/${String(limit.max)} ${limit.unit}`];

    if (sourceMeasurement.fits) {
      return {
        ...base,
        notes: 'fits',
        accepted: true,
        text,
        attempts,
        units_after: null,
        fits_after_resize: null,
        measurement: sourceMeasurement,
        handback: null,
        figure_check: null,
        trace,
        action: addWarnings(
          `${sourceMeasurement.guidance} No rewrite needed — use it as it stands, edited for this ` +
            `funder’s voice.`,
          verified,
          carriesFigures,
        ),
      };
    }

    const infeasible = sourceMeasurement.verdict === 'compression_infeasible';
    return {
      ...base,
      notes: infeasible ? 'compression_infeasible' : 'rewrite_owed',
      accepted: false,
      text: null,
      attempts,
      units_after: null,
      fits_after_resize: null,
      measurement: sourceMeasurement,
      figure_check: null,
      trace,
      handback: buildHandback({
        task: 'resize',
        sourceText: text,
        limit,
        measurement: sourceMeasurement,
        context: handbackContext,
        ...(infeasible ? { extraRules: [infeasibleRule(sourceMeasurement.ratio)] } : {}),
      }),
      action: addWarnings(
        infeasible
          ? `${sourceMeasurement.guidance} Shorten it from the handback and state which facts you ` +
              `dropped, then call this tool again with your rewrite.`
          : `${sourceMeasurement.guidance} Shorten it from the handback, then call this tool again ` +
              `with your rewrite so the length is measured rather than estimated.`,
        verified,
        carriesFigures,
      ),
    };
  }

  // ------------------------------------------------------------- the verify call: a rewrite came back
  //
  // A blank rewrite is not a rewrite, and every downstream check waves it through: it measures 0 units
  // so it fits any limit, and it states no figure so nothing is invented. Before this guard, a 95-word
  // answer with figures plus `rewrite: '   '` came back `accepted: true`, `text: '   '`, with the
  // action line "Accepted: 0/10 words, down from 95, and every figure traces to the source."
  //
  // Checked here rather than only at the tool boundary because this is a public export, and because
  // `.min(1)` on the MCP schema is satisfied by a single space — the same reason `text` is guarded in
  // `grant-resize-answer.ts`. Work package #251.
  if (input.rewrite.trim() === '') {
    const attempts = input.attempt ?? 2;
    return {
      ...base,
      notes: 'rewrite_empty',
      accepted: false,
      text: null,
      attempts,
      units_after: 0,
      fits_after_resize: null,
      measurement: sourceMeasurement,
      figure_check: null,
      trace: [
        `source: ${String(unitsBefore)}/${String(limit.max)} ${limit.unit}`,
        `attempt ${String(attempts)}: rewrite was blank — discarded`,
      ],
      handback: buildHandback({
        task: 'resize',
        sourceText: text,
        limit,
        measurement: sourceMeasurement,
        context: handbackContext,
        extraRules: [
          'REJECTED. Your rewrite was empty or whitespace only. An empty answer measures as fitting ' +
            'every limit and is not an answer. Rewrite the source text below.',
        ],
      }),
      action: addWarnings(
        `REJECTED — the rewrite was empty or whitespace only. That is not a shorter answer, it is no ` +
          `answer. Rewrite the source text from the handback and call this tool again.`,
        verified,
        carriesFigures,
      ),
    };
  }

  const rewrite = input.rewrite;
  const attempts = input.attempt ?? 2;
  const rewriteMeasurement = measure({
    ...(kbRef === null ? {} : { label: kbRef }),
    text: rewrite,
    unit: limit.unit,
    max: limit.max,
  });
  const unitsAfter = rewriteMeasurement.count;
  const fitsAfter = rewriteMeasurement.fits;
  const figureCheck = checkFigures(text, rewrite);
  const trace = [
    `source: ${String(unitsBefore)}/${String(limit.max)} ${limit.unit}`,
    `attempt ${String(attempts)}: ${String(unitsAfter)}/${String(limit.max)} ${limit.unit}`,
  ];

  // A lost slot outranks everything, including an invented figure — it is the same class of failure one
  // step earlier. An invented figure is a wrong number in the text; a dropped slot removes the
  // requirement that a number be fetched at all, so the next reader sees a sentence with no hole in it
  // and no reason to check anything. Shortening approved language is allowed; shortening away the
  // instruction to verify is not.
  const sourceSlots = slotsIn(text);
  const lostSlots = sourceSlots.filter((s) => !slotsIn(rewrite).includes(s));
  if (lostSlots.length > 0) {
    return {
      ...base,
      notes: 'slots_dropped',
      accepted: false,
      text: null,
      attempts,
      units_after: unitsAfter,
      fits_after_resize: fitsAfter,
      measurement: rewriteMeasurement,
      figure_check: figureCheck,
      trace: [...trace, `slots dropped: ${lostSlots.join(', ')}`],
      handback: buildHandback({
        task: 'resize',
        sourceText: text,
        limit,
        measurement: sourceMeasurement,
        context: handbackContext,
        extraRules: [
          `REJECTED. Your rewrite dropped the figure slot(s) ${lostSlots.map((s) => `{{${s}}}`).join(', ')}. ` +
            `Each one marks a figure that must be fetched live before this answer is submitted, so ` +
            `removing it removes the check rather than the detail. Every slot in the source must appear ` +
            `in your rewrite, spelled identically. If a clause genuinely has to go to make the limit, ` +
            `drop a clause that carries no slot.`,
        ],
      }),
      action: addWarnings(
        `REJECTED — the rewrite dropped ${lostSlots.map((s) => `{{${s}}}`).join(', ')}. A slot is the ` +
          `only thing forcing a live lookup for that figure; losing it means the answer goes out ` +
          `unverified with nothing to show it. Rewrite from the handback, keeping every slot.`,
        verified,
        carriesFigures,
      ),
    };
  }

  // An invented figure outranks a length problem, and outranks a rewrite that fits. A funder reading
  // a number LaunchPad never stated is a worse outcome than a funder reading an over-long answer, and
  // rule 1 of RESIZE_RULES calls such an output unusable rather than merely imperfect.
  if (!figureCheck.ok) {
    return {
      ...base,
      notes: 'figures_altered',
      accepted: false,
      text: null,
      attempts,
      units_after: unitsAfter,
      fits_after_resize: fitsAfter,
      measurement: rewriteMeasurement,
      figure_check: figureCheck,
      trace: [...trace, `figures invented: ${figureCheck.invented.join(', ')}`],
      handback: buildHandback({
        task: 'resize',
        sourceText: text,
        limit,
        measurement: sourceMeasurement,
        context: handbackContext,
        extraRules: [
          `REJECTED. Your rewrite states ${figureCheck.invented.length === 1 ? 'a figure' : 'figures'} ` +
            `the source answer does not: ${figureCheck.invented.join(', ')}. Rewrite again from the ` +
            `source text below, using only figures that appear in it. Dropping a figure is allowed; ` +
            `changing one or adding one is not.`,
        ],
      }),
      action: addWarnings(
        `REJECTED — the rewrite states ${figureCheck.invented.join(', ')}, which ${
          figureCheck.invented.length === 1 ? 'does' : 'do'
        } not appear in the source answer. Do not use it. Rewrite from the handback with only the ` +
          `figures the source states.`,
        verified,
        carriesFigures,
      ),
    };
  }

  if (!fitsAfter) {
    return {
      ...base,
      notes: 'still_over_limit',
      accepted: false,
      text: null,
      attempts,
      units_after: unitsAfter,
      fits_after_resize: false,
      measurement: rewriteMeasurement,
      figure_check: figureCheck,
      trace,
      handback: buildHandback({
        task: 'resize',
        sourceText: text,
        limit,
        measurement: rewriteMeasurement,
        context: handbackContext,
        extraRules: [overflowFeedback(unitsAfter, limit)],
      }),
      // "still over" is the prototype's own retry-feedback wording, kept so the two are comparable.
      action: addWarnings(
        `Your rewrite is ${String(unitsAfter)} ${limit.unit}, still over the ${String(limit.max)} ` +
          `${limit.unit} limit. Cut further from the handback and call this tool again.`,
        verified,
        carriesFigures,
      ),
    };
  }

  return {
    ...base,
    notes: 'fits',
    accepted: true,
    text: rewrite,
    attempts,
    units_after: unitsAfter,
    fits_after_resize: true,
    measurement: rewriteMeasurement,
    figure_check: figureCheck,
    handback: null,
    trace,
    action: addWarnings(
      `Accepted: ${String(unitsAfter)}/${String(limit.max)} ${limit.unit}, down from ` +
        `${String(unitsBefore)}, and every figure traces to the source. Still a draft — a person ` +
        `reviews and submits.`,
      verified,
      carriesFigures,
    ),
  };
}

/**
 * Compare the numeric claims in a rewrite against its source.
 *
 * Multiset semantics on the invented side: a rewrite stating `145` twice where the source states it
 * once is reported, because a repeated figure is a claim about a second thing. `dropped` is reported
 * as a set difference — it is informational, not a failure, so per-instance counting would only add
 * noise.
 */
export function checkFigures(source: string, rewrite: string): FigureFidelityCheck {
  const sourceFigures = extractNumericClaims(source);
  const rewriteFigures = extractNumericClaims(rewrite);

  const remaining = [...sourceFigures];
  const invented: string[] = [];
  for (const fig of rewriteFigures) {
    const at = remaining.indexOf(fig);
    if (at === -1) invented.push(fig);
    else remaining.splice(at, 1);
  }

  const inRewrite = new Set(rewriteFigures);
  return {
    ok: invented.length === 0,
    source_figures: sourceFigures,
    rewrite_figures: rewriteFigures,
    invented,
    dropped: [...new Set(sourceFigures.filter((f) => !inRewrite.has(f)))],
  };
}

/** The prototype's retry feedback, as a handback rule rather than a follow-up user message. */
function overflowFeedback(have: number, limit: FormLimit): string {
  return (
    `Your previous rewrite was ${String(have)} ${limit.unit}, still over the ${String(limit.max)} ` +
    `${limit.unit} limit. Cut further — remove the least-essential detail. Do not alter any figure ` +
    `you keep.`
  );
}

/** The rule added when compression past {@link MAX_COMPRESSION_RATIO} is being asked for. */
function infeasibleRule(ratio: number): string {
  return (
    `This needs ${String(ratio)}x compression, past the ${String(MAX_COMPRESSION_RATIO)}x point where ` +
    `shortening stops being compression. Facts WILL have to be dropped. Say which ones you dropped, ` +
    `and check first whether the field actually wants a short structured value rather than a narrative.`
  );
}

