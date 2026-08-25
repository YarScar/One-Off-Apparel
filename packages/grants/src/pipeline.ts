/**
 * pipeline.ts — resolve a captured funder form into a reviewable draft package.
 *
 * A re-expression of the prototype's `pipeline/pipeline.py` (`build_answer`, `run`,
 * `render_markdown`). Pure and deterministic: no network, no model, no database. The path is
 * form → match → knowledge-base retrieve → limit check → Markdown.
 *
 * ## What this is for
 *
 * The knowledge base exists so the calling model does not regenerate answers LaunchPad has already
 * written and approved. This module is the **assist** that gets those answers to the right questions —
 * it is not an authority that decides whether an answer may be used. So every outcome names an
 * {@link Actor}: the work either is done (`none`), needs shaping by the calling model (`llm`), or
 * needs a fact or a decision only a person has (`staff`).
 *
 * When text needs shaping, the plan carries a {@link Handback} — the source text, the limit, the
 * measurement, and the rules — and the calling model does the work. That is the whole mechanism, and
 * it is why nothing here is a dead end: an over-limit answer is handed back to be shortened, not
 * refused.
 *
 * ## What this deliberately does NOT do
 *
 * **It never makes a connector call.** It returns the figure verification work order — the exact
 * `query_*` calls a caller must run — and the caller runs them. `figures.ts` holds the security
 * reason: `runTool`'s permission check keys on the INBOUND tool name, so a grant tool that read the
 * database internally would be authorised as itself rather than as `query_finances`, laundering
 * finance and donor data past the role ACL. Do not "optimise" this by fetching here.
 *
 * **It never calls a model.** See `handback.ts` and `TAD.md` §6 decision 6. There is no Anthropic
 * client in this repository and this layer does not add one.
 *
 * **It produces nothing submittable.** A person always reviews and always submits — `PROPOSAL.md` §1.
 *
 * ## Where this goes beyond the prototype, on purpose
 *
 * Each of these exists because the prototype is demonstrably wrong on real seed data, and each is
 * pinned by a test in `pipeline.test.ts`:
 *
 * 1. **`derive_from_reference`** — a field wanting a short structured value whose knowledge-base slot
 *    holds narrative. 35 of the 43 non-narrative questions in the v0.4.1 bank route to a
 *    narrative slot, the shortest being 30 words: Truist's 30-*character* "name of your solution"
 *    field points at the 199-word `kb.program_desc`. The prototype returns that prose as the answer.
 *    This hands it back as source material to derive "Launchpad" from.
 * 2. **`structured` short values** — the fix for the case above when the value is actually known.
 *    A KB entry carries `structured[question_id] = { value, verified }`, keyed by question because
 *    slots are shared (`kb.eligibility` answers eight). The branch returns the value as a real
 *    answer before `derive_from_reference` can run. DECISIONS.md D1.
 * 2a. **`needs_expand`** — the guard on the branch above, and the reason it is numbered with it: the
 *    fix in 2 created this defect. A stored value can *fit* a funder's field and still not *answer*
 *    it, and until this existed the layer only asked the first question — 9 words returned into a
 *    200-word narrative box as `fits` with `actor: none`, so the outstanding-work count went down
 *    while the draft got worse. `limits.ts::underfillsProseField` is the test. The handback carries
 *    the confirmed value as an anchor that must survive verbatim *and* the slot prose as material,
 *    under `EXPAND_RULES`, whose ceiling-not-a-target rule is what stops the guard from trading a
 *    silent under-answer for a padded invented one. Board `grant-h32`; DECISIONS.md D1e.
 * 3. **`fetch_figure`** — a number question whose answer is a live figure, never a frozen one.
 *    `figures.ts` names the exact `query_*` call; the caller runs it and writes the live number.
 *    DECISIONS.md D1b.
 * 4. **`needs_attachment`** — split out of the above, because an upload is the one case the calling
 *    model cannot do. A document is not text it can write.
 * 5. **`compression_infeasible`** — over the limit by more than {@link MAX_COMPRESSION_RATIO}. Still
 *    handed back for shaping, but carrying the warning that facts will have to be dropped and that
 *    the reply must say which. The prototype reports a 46x overrun identically to a 1.2x one.
 * 6. **`carries_figures`** — set independently of the KB's own `verified` flag. `figures.ts` shows
 *    `verified` is the wrong axis for staleness: it fires on `kb.docs`, which contains no figures at
 *    all, and stays silent on `kb.metrics`, which contains five, and whose wage figure drifts by
 *    ~$1,500 every four days. Its trigger is now `slots.ts::needsManualFigureCheck` rather than
 *    `containsNumericClaim` — the latter matches any two-digit run, which after the language-only
 *    scrub means it fires on `Building 21`, the fiscal sponsor's name. Work package #275.
 * 7. **`needs_live_figures` / `needs_application_figures`** — the language-only gate, and the branch
 *    that reorders the rest. Stored answers hold `{{slot}}` tokens where a figure belongs, and this
 *    module will not return slotted text as an `answer`: the failure mode moves from a confidently
 *    wrong number to an obviously incomplete one. **The gate runs before every length branch**, because
 *    filling a slot changes the length and resizing first measures the wrong text — so a slotted,
 *    over-limit answer reports `needs_live_figures` and carries its measurement so the coming resize is
 *    visible. `slots.ts` holds the rule and the two registers that make it liveable. Work package #275.
 */

import { loadBank, loadKnowledgeBase, loadIntegrityReport, type IntegrityWarning } from './data.js';
import {
  buildFigureWorkOrder,
  figureCheckForQuestion,
  type FigureWorkOrder,
} from './figures.js';
import { buildHandback, type Handback, type HandbackContext } from './handback.js';
import { MAX_COMPRESSION_RATIO, measure, underfillsProseField, type Measurement } from './limits.js';
import { DEFAULT_THRESHOLD, matchQuestion, type MatchResult } from './matcher.js';
import { infeasibleRule } from './resize.js';
import {
  FRAMINGS,
  NON_NARRATIVE_ANSWER_TYPES,
  type AnswerType,
  type Framing,
  type FormLimit,
  type IncomingForm,
  type KnowledgeBase,
  type QuestionBank,
} from './schemas.js';
import {
  figureCallsFor,
  needsManualFigureCheck,
  resolveSlots,
  type SlotRequirement,
} from './slots.js';
import { addWarnings } from './warnings.js';

/**
 * Who does the next step on one question.
 *
 * This is the axis that matters to a caller, and it is why the outcome is not a single
 * "needs a human" flag. `llm` and `staff` are both "not finished", but they are answered by different
 * parties: one is text that needs shaping, the other is a fact or a decision the layer does not hold.
 * Conflating them either sends a model to fetch a signature or sends a person to count words.
 */
export type Actor = 'none' | 'llm' | 'staff';

/**
 * The outcome for one question. Every value either names who acts next or says the text is ready for
 * review; none of them means "submit this".
 *
 * `fits`, `ready`, `needs_resize`, `needs_review`, `per_application`, `kb_gap` and `kb_placeholder`
 * are the prototype's. `derive_from_reference`, `needs_attachment` and `compression_infeasible` are
 * additions — see the module comment.
 */
export type AnswerStatus =
  | 'fits'
  | 'ready'
  | 'needs_resize'
  | 'needs_expand'
  | 'compression_infeasible'
  | 'derive_from_reference'
  | 'needs_attachment'
  | 'needs_review'
  | 'per_application'
  | 'kb_gap'
  | 'kb_placeholder'
  | 'fetch_figure'
  | 'figure_definitional'
  | 'needs_live_figures'
  | 'needs_application_figures';

/** Which actor each status routes to. Exported so a caller can group without restating the mapping. */
export const STATUS_ACTOR: Readonly<Record<AnswerStatus, Actor>> = {
  fits: 'none',
  ready: 'none',
  needs_resize: 'llm',
  needs_expand: 'llm',
  compression_infeasible: 'llm',
  derive_from_reference: 'llm',
  fetch_figure: 'llm',
  figure_definitional: 'staff',
  needs_live_figures: 'llm',
  needs_application_figures: 'staff',
  needs_attachment: 'staff',
  needs_review: 'staff',
  per_application: 'staff',
  kb_gap: 'staff',
  kb_placeholder: 'staff',
};

/** One question resolved. Shaped for JSON — `null` rather than absent keys on the common fields. */
export interface AnswerPlan {
  /** The funder's wording, verbatim, so a result can be matched back to the form. */
  readonly incoming: string;
  readonly matched_id: string | null;
  readonly canonical: string | null;
  readonly category: string | null;
  readonly answer_type: AnswerType | null;
  readonly kb_ref: string | null;
  readonly matched_via: string | null;
  readonly confidence: number;
  readonly confident: boolean;
  readonly status: AnswerStatus;
  /** Who does the next step. Derived from {@link STATUS_ACTOR}. */
  readonly actor: Actor;
  /** What to do about it, in one sentence. Never empty. */
  readonly action: string;
  /** The funder's stated limit for this question, or `null` when the form states none. */
  readonly limit: FormLimit | null;
  readonly kb_label?: string;
  /** The KB's own flag: "grounded in filed application material". NOT a statement about currency. */
  readonly verified?: boolean;
  /** Text ready for review. Absent whenever shaping is still owed — see `handback`. */
  readonly answer?: string;
  /**
   * The work owed to the calling model when that work is **shaping text**, with everything needed to
   * do it.
   *
   * This once read "present exactly when `actor` is `llm`", which stopped being true when D1b added
   * `fetch_figure` — a second kind of model work, where the task is running a `query_*` call rather
   * than rewriting prose, and so carries {@link AnswerPlan.figure_call} instead. The invariant a
   * caller can still rely on is the one that matters: **every `llm` result carries exactly one of
   * `handback` or `figure_call`**, so the outstanding work is still drivable off the result alone.
   * `apps/mcp-server/src/__tests__/tools.test.ts` asserts that form.
   */
  readonly handback?: Handback;
  /** Present whenever the form stated a limit and there was text to measure against it. */
  readonly measurement?: Measurement;
  /** The text carries a currency, percentage, or multi-digit figure that must be verified live. */
  readonly carries_figures?: boolean;
  /** Present on a `fetch_figure` result: the exact `query_*` call the caller must run. */
  readonly figure_call?: { readonly tool: string; readonly args: Readonly<Record<string, string | number | boolean>> };
  /** Present when the answer came from a per-question structured value, not the slot's narrative. */
  readonly from_structured?: boolean;
  /**
   * Present on a `needs_live_figures` or `needs_application_figures` result: every unfilled slot in
   * the stored text, with the call or the decision that fills it.
   */
  readonly figure_slots?: readonly SlotRequirement[];
  /**
   * The stored text with its slots still visible, on a result that withheld `answer` because of them.
   *
   * Named `figure_template` rather than `answer` deliberately. It is not an answer and must not render
   * as one: a caller that treated it as an answer would paste `{{wages_total}}` into a funder's portal.
   * The name is the warning.
   */
  readonly figure_template?: string;
}

/**
 * The language-only gate: refuse to surface stored text that still has figure-shaped holes in it.
 *
 * Returns a plan when `surfaced` carries unfilled slots, and `null` when it does not — so a caller
 * reads as `const gated = figureGate(...); if (gated !== null) return gated;` at each point where text
 * would otherwise become an answer.
 *
 * **Two statuses, not one, and the split is by who fills the hole.** A `live` slot is a `query_*` call,
 * which the calling model runs — the same division of labour `fetch_figure` already uses. A
 * `per_application` slot is an amount or a period belonging to *this* submission, which no connector
 * holds; a model handed an empty ask-amount slot and told to fill it will fill it, so those route to
 * staff. When a text carries both kinds, staff wins: the model cannot finish the answer regardless, and
 * reporting it as model work would move it off the staff list it needs to be on.
 *
 * `answer` is never set on either path. This is the same discipline the `needs_expand` branches use and
 * for a sharper reason: text containing `{{wages_total}}` rendered as an answer is text a caller can
 * paste into a funder's portal. It travels as {@link AnswerPlan.figure_template} instead.
 */
/**
 * What both `figureGate` callers (`withEntry`, `withStructured`) already have on hand: every
 * `AnswerPlan` field except the three (`status`, `actor`, `action`) that differ by branch and are
 * added at each return site below. Naming this instead of taking `Record<string, unknown>` means
 * `shared`'s construction is checked against `AnswerPlan`'s actual fields, and each return site's
 * `{ ...shared, status, actor, action }` is checked as a complete `AnswerPlan` — no cast needed.
 */
type FigureGateBase = Omit<AnswerPlan, 'status' | 'actor' | 'action'>;

function figureGate(
  surfaced: string,
  withEntry: FigureGateBase,
  limit: FormLimit | null,
  context: HandbackContext,
  kbRef: string,
): AnswerPlan | null {
  const requirements = resolveSlots(surfaced);
  if (requirements.length === 0) return null;

  const perApplication = requirements.filter((r) => r.kind === 'per_application');
  const live = requirements.filter((r) => r.kind === 'live');

  // The template is still measured against the limit even though the gate preempts the resize branches.
  // Sequencing is why the gate goes first — filling changes the length, so resizing before filling
  // measures the wrong text — but the caller still needs to know a shortening is coming, and dropping
  // the measurement here would report an over-limit answer as though length were not an issue. It also
  // keeps `summary.all_fit` honest: without it, a 3x-over template reads as fitting.
  const measurement = limit === null ? null : measureAgainst(surfaced, limit, kbRef);
  const shared: FigureGateBase = {
    ...withEntry,
    figure_slots: requirements,
    figure_template: surfaced,
    limit,
    ...(measurement === null ? {} : { measurement }),
  };
  const overLimit = measurement !== null && !measurement.fits;

  if (perApplication.length > 0) {
    return {
      ...shared,
      status: 'needs_application_figures',
      actor: STATUS_ACTOR.needs_application_figures,
      action:
        `${kbRef} needs ${String(perApplication.length)} value(s) that belong to this application ` +
        `rather than to Launchpad: ${perApplication.map((r) => r.slot).join(', ')}. No connector holds ` +
        `them — a person supplies them for this submission. ` +
        (live.length > 0
          ? `The remaining ${String(live.length)} slot(s) are live figures; run their calls at the ` +
            `same time.`
          : ''),
    };
  }

  return {
    ...shared,
    status: 'needs_live_figures',
    actor: STATUS_ACTOR.needs_live_figures,
    action:
      `${kbRef} is stored as language with its figures removed. Fill ${String(live.length)} slot(s) ` +
      `from ${String(figureCallsFor(surfaced).length)} live call(s), then use the result. A frozen ` +
      `figure is not an acceptable substitute, and neither is deleting the sentence.` +
      (overLimit
        ? ` It will also need shortening afterwards — the template is ${String(measurement.count)}/` +
          `${String(measurement.max)} ${measurement.unit} before any figure is written. Fill ` +
          `first, then resize: shortening before the figures are in measures the wrong text.`
        : ''),
    handback: buildHandback({
      task: 'fill_figures',
      sourceText: surfaced,
      limit,
      measurement,
      context,
      figureSlots: requirements,
      ...(overLimit
        ? {
            extraRules: [
              // `measurement`, not `limit`, for the numbers: they are the same values, and reading them
              // off the measurement is what lets `overLimit` narrow the type. Only `measurement` is
              // aliased by that guard.
              `This template is already over the ${String(measurement.max)} ${measurement.unit} limit ` +
                `before any figure is written. Fill the slots anyway and do NOT shorten as you go — ` +
                `then pass the filled text to grant_resize_answer. Trimming while filling is how an ` +
                `approved sentence loses a clause nobody decided to drop.`,
            ],
          }
        : {}),
    }),
  };
}

/** Narrows a form's free-typed `emphasis` string to a {@link Framing}, so `by_framing` can index it. */
function isFraming(x: string): x is Framing {
  return (FRAMINGS as readonly string[]).includes(x);
}

/**
 * Resolve one matched question to an answer plan.
 *
 * Branch order is the prototype's and is load-bearing: confidence, then whether a KB slot exists,
 * then whether it resolves, then whether it is real content, and only then length. A question that
 * fails an earlier gate must not be measured against a limit, because there is nothing trustworthy
 * to measure.
 */
export function buildAnswer(
  match: MatchResult,
  limit: FormLimit | null,
  kb: KnowledgeBase,
  formContext: Pick<HandbackContext, 'funder' | 'emphasis'> = { funder: null, emphasis: null },
): AnswerPlan {
  const base = {
    incoming: match.incoming,
    matched_id: match.matched_id,
    canonical: match.canonical,
    category: match.category,
    answer_type: match.answer_type,
    kb_ref: match.kb_ref,
    matched_via: match.matched_via,
    confidence: match.confidence,
    confident: match.is_confident,
    limit,
  };

  if (!match.is_confident) {
    return {
      ...base,
      status: 'needs_review',
      actor: STATUS_ACTOR.needs_review,
      action:
        'Low match confidence — confirm the mapping or add this wording to the question bank as a ' +
        'variant. Do not route it to the kb_ref shown.',
    };
  }

  if (match.kb_ref === null) {
    return {
      ...base,
      status: 'per_application',
      actor: STATUS_ACTOR.per_application,
      action:
        'No stored answer — this is an application-specific value (a requested amount, a signature, ' +
        'a date). Fill it in for this application.',
    };
  }

  const entry = kb.answers[match.kb_ref];
  if (entry === undefined) {
    return {
      ...base,
      status: 'kb_gap',
      actor: STATUS_ACTOR.kb_gap,
      action: `The knowledge base has no entry for ${match.kb_ref} — write one.`,
    };
  }

  const text = entry.text;
  const verified = entry.verified;
  // `needsManualFigureCheck`, not `containsNumericClaim`: the latter matches any two-digit run, which
  // after the scrub means it fires on "Building 21" and flags the fiscal sponsor's name for live
  // verification. See `slots.ts` for the reasoning; the short version is that a warning firing on
  // everything is a warning nobody reads.
  const carriesFigures = needsManualFigureCheck(text);
  const withEntry = { ...base, kb_label: entry.label, verified, carries_figures: carriesFigures };
  const context: HandbackContext = { ...formContext, answers: entry.label };

  // A placeholder is not content. Length-checking it would measure nothing, and handing it back for
  // shaping would ask the model to compress a `[PLACEHOLDER]` marker.
  if (text.trimStart().startsWith('[PLACEHOLDER')) {
    return {
      ...withEntry,
      status: 'kb_placeholder',
      actor: STATUS_ACTOR.kb_placeholder,
      action: `Knowledge base entry ${match.kb_ref} is a placeholder, not real content — supply it.`,
      answer: text,
    };
  }

  // An upload is the one outstanding task the calling model cannot do, so it splits off from the
  // other non-narrative types before they are handed back.
  if (match.answer_type === 'attachment') {
    return {
      ...withEntry,
      status: 'needs_attachment',
      actor: STATUS_ACTOR.needs_attachment,
      action:
        `This question wants a document upload, not text. ${match.kb_ref} holds the checklist of ` +
        `what to attach — a person has to gather and upload the files.`,
      answer: text,
    };
  }

  // A number question whose answer is a live figure, never a frozen KB value. figures.ts names the
  // exact query_* call; the caller runs it under its own name (TAD decision 3) and writes the live
  // number. A definitional check escalates to staff — the number depends on which population the
  // funder means, and a person confirms that before it is written. Two statuses, not one, so the
  // actor invariant holds: a caller groups by STATUS_ACTOR without restating the mapping.
  if (match.answer_type === 'number' && match.matched_id !== null) {
    const figure = figureCheckForQuestion(match.matched_id);
    if (figure !== undefined) {
      const definitional = figure.conflict_kind === 'definitional';
      return {
        ...withEntry,
        status: definitional ? 'figure_definitional' : 'fetch_figure',
        actor: definitional ? STATUS_ACTOR.figure_definitional : STATUS_ACTOR.fetch_figure,
        action: definitional
          ? `This question wants a live ${figure.tool} figure, but the check is definitional ` +
            `(${figure.claim}). Run the call, then have staff confirm which population the funder ` +
            `means before writing the number.`
          : `This question wants a live ${figure.tool} figure. Run it with ` +
            `${JSON.stringify(figure.args)} and write the returned number — do not quote a frozen ` +
            `KB figure. Before finalizing, call grant_verify_figure with this answer text, this ` +
            `figure_call, and ${figure.tool}'s result to confirm the number you wrote actually came ` +
            `from it.`,
        figure_call: { tool: figure.tool, args: figure.args },
      };
    }
  }

  // A per-question structured value is the answer, not source material. Slots are shared — one slot
  // answers many questions — so the key is the question id, not the slot. Returns before the
  // derive_from_reference branch so a stored short value never becomes prose to derive from.
  const structured = match.matched_id === null ? undefined : entry.structured?.[match.matched_id];
  if (structured !== undefined) {
    // A structured value can vary by fiscal-sponsorship framing (`cover.fiscal_sponsor` is the case
    // that exists today) — the same fact reads differently depending which posture staff picked.
    // Falls back to `value` when the framing is missing or the slot carries no variant for it.
    const emphasis = formContext.emphasis;
    const structuredValue =
      emphasis !== null && isFraming(emphasis)
        ? (structured.by_framing?.[emphasis] ?? structured.value)
        : structured.value;
    const structuredVerified = structured.verified ?? entry.verified;
    const structuredFigures = needsManualFigureCheck(structuredValue);
    const withStructured = {
      ...withEntry,
      verified: structuredVerified,
      carries_figures: structuredFigures,
      from_structured: true,
    };
    // The gate runs on the structured VALUE, not on the slot's narrative: this branch surfaces the
    // value, so that is the text whose holes matter. `eligibility.budget_size` is the case — it hands a
    // funder the fiscal-year expense figure with no prose around it, so a slot there is the whole answer
    // rather than a detail inside one.
    const gatedStructured = figureGate(structuredValue, withStructured, limit, context, match.kb_ref);
    if (gatedStructured !== null) return gatedStructured;
    // The handback's `sourceText` for an `expand` task is deliberately `text` (the slot's full
    // narrative), not `structuredValue` — the confirmed value survives verbatim as the anchor, and the
    // prose is what the model is allowed to draw on to write the rest. See `resolveTextAnswer`.
    return resolveTextAnswer(structuredValue, {
      base: withStructured,
      limit,
      kbRef: match.kb_ref,
      answerType: match.answer_type,
      context,
      verified: structuredVerified,
      carriesFigures: structuredFigures,
      expandSourceText: text,
      anchorValue: structuredValue,
      noLimitAction: 'No stated limit — use the stored structured value, edited for this funder’s voice.',
      underfilledAction: (measurement) =>
        `The stored value fits (${String(measurement.count)}/${String(measurement.max)} ` +
        `${measurement.unit}) but answers only a fraction of a field this size. Keep the value ` +
        `verbatim and write the rest of the answer around it from ${match.kb_ref} — up to the ` +
        `limit, and no further than the source material supports.`,
      shortenVerb: 'Shorten the stored value',
    });
  }

  // Every remaining branch surfaces the slot's narrative — as an answer, or as source material for a
  // rewrite. So the gate goes here, ahead of all of them: text with figure-shaped holes is not an
  // answer, and it is not usable source material for deriving a value or writing a fuller one either.
  // Placed after the `number`/`fetch_figure` branch above, which never touches the text at all.
  const gated = figureGate(text, withEntry, limit, context, match.kb_ref);
  if (gated !== null) return gated;

  // A field wanting a short structured value cannot take narrative prose, however well it fits. Hand
  // the prose back as source material so the model can derive the value from it.
  if (match.answer_type !== null && NON_NARRATIVE_ANSWER_TYPES.has(match.answer_type)) {
    const measurement = limit === null ? null : measureAgainst(text, limit, match.kb_ref);
    return {
      ...withEntry,
      status: 'derive_from_reference',
      actor: STATUS_ACTOR.derive_from_reference,
      action: addWarnings(
        `This question wants a ${describeAnswerType(match.answer_type)}, and ${match.kb_ref} holds ` +
          `narrative prose. Derive the value from the source material in handback — do not paste the ` +
          `prose into the field. If the source does not contain it, flag it for staff.`,
        verified,
        carriesFigures,
      ),
      handback: buildHandback({
        task: 'derive_short_value',
        sourceText: text,
        limit,
        measurement,
        context,
      }),
      ...(measurement === null ? {} : { measurement }),
    };
  }

  // FITTING IS NOT ANSWERING — this branch and the structured one above resolve to the same
  // gate→measure→needs_expand/fits/needs_resize sequence, so `resolveTextAnswer` covers both. The only
  // real differences are which text is the candidate answer (the structured value vs. this slot's
  // narrative, `text`), whether an anchor value exists, and wording. Keeping them unified is what
  // stops a guard landing on one branch and being missing from the other — `underfillsProseField` was
  // fixed on the structured path first and had to be separately re-added here (work package #252); the
  // `compression_infeasible` `extraRules` warning had the same gap until this unification closed it.
  return resolveTextAnswer(text, {
    base: withEntry,
    limit,
    kbRef: match.kb_ref,
    answerType: match.answer_type,
    context,
    verified,
    carriesFigures,
    expandSourceText: text,
    noLimitAction: 'No stated limit — use the canonical answer, edited for this funder’s voice.',
    underfilledAction: (measurement) =>
      `The stored answer fits (${String(measurement.count)}/${String(measurement.max)} ` +
      `${measurement.unit}) but fills only a fraction of a field this size. Write the fuller ` +
      `answer from ${match.kb_ref} — up to the limit, and no further than that material ` +
      `supports. If it does not support more, say what is missing rather than padding.`,
    shortenVerb: 'Shorten it from the handback',
  });
}

/**
 * The fields both `buildAnswer` callers of {@link resolveTextAnswer} have already spread onto their
 * result before handing off — `withStructured` and `withEntry`, respectively. Kept as its own type
 * rather than a generic parameter on `resolveTextAnswer`: a type parameter is opaque inside the
 * function body, so the compiler cannot verify a spread of it plus a handful of literal fields
 * satisfies {@link AnswerPlan} — this fixed shape is what lets it check that structurally, the same way
 * the two inline call sites did before this was extracted.
 */
interface AnswerPlanBase {
  readonly incoming: string;
  readonly matched_id: string | null;
  readonly canonical: string | null;
  readonly category: string | null;
  readonly answer_type: AnswerType | null;
  readonly kb_ref: string | null;
  readonly matched_via: string | null;
  readonly confidence: number;
  readonly confident: boolean;
  readonly limit: FormLimit | null;
  readonly kb_label?: string;
  readonly verified?: boolean;
  readonly carries_figures?: boolean;
  readonly from_structured?: boolean;
}

/**
 * The shared gate→measure→`needs_expand`/`fits`/`needs_resize` sequence, run once for the structured
 * value branch and once for the plain narrative branch of {@link buildAnswer}.
 *
 * Extracted because the two call sites used to hand-duplicate this ~140-line sequence, and it bit
 * exactly the way duplicated state machines do: `underfillsProseField` (board `grant-h32`, work
 * package #252) landed on one copy and had to be separately re-added to the other. Unifying here means
 * a guard added once covers both candidate texts — the structured value and the slot's narrative —
 * with no second copy to remember.
 *
 * `opts.base` is the per-branch spread object (`withStructured` or `withEntry`); `opts.anchorValue`,
 * when present, is attached to the `expand` handback so the confirmed value survives verbatim while
 * the model writes the rest from `opts.expandSourceText`. `opts.noLimitAction`, `opts.underfilledAction`
 * and `opts.shortenVerb` are the only wording that legitimately differs between the two callers.
 */
function resolveTextAnswer(
  candidateText: string,
  opts: {
    readonly base: AnswerPlanBase;
    readonly limit: FormLimit | null;
    readonly kbRef: string;
    readonly answerType: AnswerType | null;
    readonly context: HandbackContext;
    readonly verified: boolean | null;
    readonly carriesFigures: boolean;
    readonly expandSourceText: string;
    readonly anchorValue?: string;
    readonly noLimitAction: string;
    readonly underfilledAction: (measurement: Measurement) => string;
    readonly shortenVerb: string;
  },
): AnswerPlan {
  const {
    base,
    limit,
    kbRef,
    answerType,
    context,
    verified,
    carriesFigures,
    expandSourceText,
    anchorValue,
    noLimitAction,
    underfilledAction,
    shortenVerb,
  } = opts;

  if (limit === null) {
    return {
      ...base,
      status: 'ready',
      actor: STATUS_ACTOR.ready,
      action: addWarnings(noLimitAction, verified, carriesFigures),
      answer: candidateText,
    };
  }

  const measurement = measureAgainst(candidateText, limit, kbRef);

  if (measurement.fits) {
    // A candidate can measure inside a funder's cap and still leave most of the field unanswered —
    // `underfillsProseField` is the test. The value/text is deliberately NOT returned as `answer` on
    // this path: present, it reads as a finished answer to anything rendering the package, and the
    // whole point here is that it is not one yet.
    if (underfillsProseField(measurement, answerType)) {
      return {
        ...base,
        status: 'needs_expand',
        actor: STATUS_ACTOR.needs_expand,
        action: addWarnings(underfilledAction(measurement), verified, carriesFigures),
        handback: buildHandback({
          task: 'expand',
          sourceText: expandSourceText,
          limit,
          measurement,
          context,
          ...(anchorValue !== undefined ? { anchorValue } : {}),
        }),
        measurement,
      };
    }
    return {
      ...base,
      status: 'fits',
      actor: STATUS_ACTOR.fits,
      action: addWarnings(measurement.guidance, verified, carriesFigures),
      answer: candidateText,
      measurement,
    };
  }

  // Over the limit. Hand it back to be shortened — this is the assist, not a refusal. Past
  // MAX_COMPRESSION_RATIO the reply has to drop facts, which is an editorial choice, so the model is
  // told to name what it dropped rather than doing it silently.
  const infeasible = measurement.verdict === 'compression_infeasible';
  return {
    ...base,
    status: infeasible ? 'compression_infeasible' : 'needs_resize',
    actor: infeasible ? STATUS_ACTOR.compression_infeasible : STATUS_ACTOR.needs_resize,
    action: addWarnings(
      infeasible
        ? `${measurement.guidance} ${shortenVerb}, and state which facts you dropped so a reviewer ` +
          `can put them back if the funder wants them.`
        : `${measurement.guidance} ${shortenVerb}, then re-measure.`,
      verified,
      carriesFigures,
    ),
    handback: buildHandback({
      task: 'resize',
      sourceText: candidateText,
      limit,
      measurement,
      context,
      ...(infeasible ? { extraRules: [infeasibleRule(measurement.ratio)] } : {}),
    }),
    measurement,
  };
}

/** {@link measure} with the KB slot as the label, so a batched result maps back to its source. */
function measureAgainst(text: string, limit: FormLimit, kbRef: string): Measurement {
  return measure({ label: kbRef, text, unit: limit.unit, max: limit.max });
}

/** Plain-language name for an answer type, for the `derive_from_reference` action line. */
function describeAnswerType(type: AnswerType): string {
  switch (type) {
    case 'field':
      return 'short field value';
    case 'number':
      return 'number';
    case 'boolean':
      return 'yes/no answer';
    case 'single_select':
      return 'single choice from the funder’s options';
    case 'multi_select':
      return 'selection from the funder’s options';
    case 'demographic':
      return 'demographic figure';
    case 'attachment':
      return 'document upload';
    case 'narrative':
      return 'narrative';
  }
}

export interface DraftSummary {
  readonly total: number;
  /** Count per {@link AnswerStatus}. Sums to `total`. */
  readonly by_status: Readonly<Record<string, number>>;
  /** Count per {@link Actor}. Sums to `total`. The two outstanding-work numbers a caller acts on. */
  readonly by_actor: Readonly<Record<Actor, number>>;
  /** True when no answer overran a stated limit. */
  readonly all_fit: boolean;
}

export interface DraftPackage {
  readonly form: IncomingForm['meta'];
  readonly summary: DraftSummary;
  readonly results: readonly AnswerPlan[];
  /** KB slots this draft actually drew on, sorted. Scopes the figure work order. */
  readonly kb_refs_used: readonly string[];
  /**
   * The `query_*` calls the caller must run to verify the figures in this draft. This module
   * returns them; it never runs one.
   */
  readonly figure_work_order: FigureWorkOrder;
  /** Cross-file seed defects, echoed so nobody drafts against a known-broken corpus unknowingly. */
  readonly integrity_warnings: readonly IntegrityWarning[];
}

/**
 * Run the whole form: match every question, resolve every answer, and assemble the package.
 *
 * The figure work order is scoped to the KB slots this draft actually used, so a reviewer gets the
 * checks that this draft can get wrong rather than the whole map.
 */
export function runPipeline(
  form: IncomingForm,
  bank: QuestionBank = loadBank(),
  kb: KnowledgeBase = loadKnowledgeBase(),
  threshold: number = DEFAULT_THRESHOLD,
): DraftPackage {
  const formContext = {
    funder: form.meta.funder,
    emphasis: form.meta.framing ?? null,
  };
  const results = form.questions.map((q) =>
    buildAnswer(matchQuestion(q.text, bank, threshold), q.limit ?? null, kb, formContext),
  );

  const byStatus: Record<string, number> = {};
  const byActor: Record<Actor, number> = { none: 0, llm: 0, staff: 0 };
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byActor[r.actor] += 1;
  }

  // Only slots that produced text a reviewer or the model will actually read. A kb_gap names a slot
  // that does not exist, and scoping figure checks by it would be meaningless.
  //
  // `figure_template` is in the list because a `needs_application_figures` result carries neither an
  // `answer` nor a `handback` — it is the one gated path with no handback — and omitting it would drop
  // that slot's checks from the scoped work order, which is the same silent-omission failure
  // `data.ts::figure_check_ref_dangling` exists to catch.
  const kbRefsUsed = [
    ...new Set(
      results
        .filter(
          (r) =>
            r.answer !== undefined || r.handback !== undefined || r.figure_template !== undefined,
        )
        .map((r) => r.kb_ref)
        .filter((ref): ref is string => ref !== null),
    ),
  ].sort();

  return {
    form: form.meta,
    summary: {
      total: results.length,
      by_status: byStatus,
      by_actor: byActor,
      all_fit: results.every((r) => r.measurement === undefined || r.measurement.fits),
    },
    results,
    kb_refs_used: kbRefsUsed,
    figure_work_order: buildFigureWorkOrder(kbRefsUsed, kb),
    integrity_warnings: loadIntegrityReport(),
  };
}

// --------------------------------------------------------------------------- Markdown render
//
// Moved to render-markdown.ts (2026-08-24) — pure presentation with zero coupling back into the
// resolution logic above, so it gained nothing from sharing this file and was most of what pushed
// pipeline.ts over 1000 lines. Re-exported here so existing imports of `renderMarkdown`/`STATUS_NOTE`
// from `./pipeline.js` keep working unchanged.

export { renderMarkdown, STATUS_NOTE } from './render-markdown.js';

/**
 * The compression ceiling, re-exported so a caller reading `compression_infeasible` can name the
 * threshold it crossed without importing `limits.js` as well.
 */
export { MAX_COMPRESSION_RATIO };
