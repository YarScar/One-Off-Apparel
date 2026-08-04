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
 *    holds narrative. Every one of the 42 non-narrative questions in the v0.4.0 bank routes to a
 *    narrative slot, the shortest being 30 words: Truist's 30-*character* "name of your solution"
 *    field points at the 199-word `kb.program_desc`. The prototype returns that prose as the answer.
 *    This hands it back as source material to derive "Launchpad" from.
 * 2. **`needs_attachment`** — split out of the above, because an upload is the one case the calling
 *    model cannot do. A document is not text it can write.
 * 3. **`compression_infeasible`** — over the limit by more than {@link MAX_COMPRESSION_RATIO}. Still
 *    handed back for shaping, but carrying the warning that facts will have to be dropped and that
 *    the reply must say which. The prototype reports a 46x overrun identically to a 1.2x one.
 * 4. **`carries_figures`** — set from {@link containsNumericClaim}, independently of the KB's own
 *    `verified` flag. `figures.ts` shows `verified` is the wrong axis for staleness: it fires on
 *    `kb.docs`, which contains no figures at all, and stays silent on `kb.metrics`, which contains
 *    five, and whose wage figure drifts by ~$1,500 every four days.
 */

import { loadBank, loadKnowledgeBase, loadIntegrityReport, type IntegrityWarning } from './data.js';
import { buildFigureWorkOrder, containsNumericClaim, type FigureWorkOrder } from './figures.js';
import { buildHandback, type Handback, type HandbackContext } from './handback.js';
import { MAX_COMPRESSION_RATIO, measure, type Measurement } from './limits.js';
import { DEFAULT_THRESHOLD, matchQuestion, type MatchResult } from './matcher.js';
import {
  NON_NARRATIVE_ANSWER_TYPES,
  type AnswerType,
  type FormLimit,
  type IncomingForm,
  type KnowledgeBase,
  type QuestionBank,
} from './schemas.js';

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
  | 'compression_infeasible'
  | 'derive_from_reference'
  | 'needs_attachment'
  | 'needs_review'
  | 'per_application'
  | 'kb_gap'
  | 'kb_placeholder';

/** Which actor each status routes to. Exported so a caller can group without restating the mapping. */
export const STATUS_ACTOR: Readonly<Record<AnswerStatus, Actor>> = {
  fits: 'none',
  ready: 'none',
  needs_resize: 'llm',
  compression_infeasible: 'llm',
  derive_from_reference: 'llm',
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
   * The work owed to the calling model, with everything needed to do it. Present exactly when
   * `actor` is `llm`, so a caller can drive every outstanding rewrite off this field alone.
   */
  readonly handback?: Handback;
  /** Present whenever the form stated a limit and there was text to measure against it. */
  readonly measurement?: Measurement;
  /** The text carries a currency, percentage, or multi-digit figure that must be verified live. */
  readonly carries_figures?: boolean;
}

const UNVERIFIED_SUFFIX = '  ⚠ Figures unverified — confirm with staff before submitting.';
const FIGURES_SUFFIX =
  '  ⚠ Carries figures — verify every one against live data via the figure work order before ' +
  'publishing. The stored figures drift.';

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
  const carriesFigures = containsNumericClaim(text);
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

  // A field wanting a short structured value cannot take narrative prose, however well it fits. Hand
  // the prose back as source material so the model can derive the value from it.
  if (match.answer_type !== null && NON_NARRATIVE_ANSWER_TYPES.has(match.answer_type)) {
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
        measurement: limit === null ? null : measureAgainst(text, limit, match.kb_ref),
        context,
      }),
      ...(limit === null ? {} : { measurement: measureAgainst(text, limit, match.kb_ref) }),
    };
  }

  if (limit === null) {
    return {
      ...withEntry,
      status: 'ready',
      actor: STATUS_ACTOR.ready,
      action: addWarnings(
        'No stated limit — use the canonical answer, edited for this funder’s voice.',
        verified,
        carriesFigures,
      ),
      answer: text,
    };
  }

  const measurement = measureAgainst(text, limit, match.kb_ref);

  if (measurement.fits) {
    return {
      ...withEntry,
      status: 'fits',
      actor: STATUS_ACTOR.fits,
      action: addWarnings(measurement.guidance, verified, carriesFigures),
      answer: text,
      measurement,
    };
  }

  // Over the limit. Hand it back to be shortened — this is the assist, not a refusal. Past
  // MAX_COMPRESSION_RATIO the reply has to drop facts, which is an editorial choice, so the model is
  // told to name what it dropped rather than doing it silently.
  const infeasible = measurement.verdict === 'compression_infeasible';
  return {
    ...withEntry,
    status: infeasible ? 'compression_infeasible' : 'needs_resize',
    actor: infeasible ? STATUS_ACTOR.compression_infeasible : STATUS_ACTOR.needs_resize,
    action: addWarnings(
      infeasible
        ? `${measurement.guidance} Shorten it from the handback, and state which facts you dropped ` +
          `so a reviewer can put them back if the funder wants them.`
        : `${measurement.guidance} Shorten it from the handback, then re-measure.`,
      verified,
      carriesFigures,
    ),
    handback: buildHandback({
      task: 'resize',
      sourceText: text,
      limit,
      measurement,
      context,
      ...(infeasible
        ? {
            extraRules: [
              `This needs ${String(measurement.ratio)}x compression, past the ${String(MAX_COMPRESSION_RATIO)}x ` +
                `point where shortening stops being compression. Facts WILL have to be dropped. Say ` +
                `which ones you dropped, and check first whether the field actually wants a short ` +
                `structured value rather than a narrative.`,
            ],
          }
        : {}),
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

/**
 * Append the two data-honesty warnings an action line may need.
 *
 * Both can apply at once and both are appended, because they say different things: `verified:false`
 * means the text was never grounded in a filed application, while `carries_figures` means the text
 * states numbers that have since moved. A `verified:true` answer full of drifting figures is the
 * common case and the dangerous one.
 */
function addWarnings(action: string, verified: boolean, carriesFigures: boolean): string {
  let out = action;
  if (!verified) out += UNVERIFIED_SUFFIX;
  if (carriesFigures) out += FIGURES_SUFFIX;
  return out;
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
  const kbRefsUsed = [
    ...new Set(
      results
        .filter((r) => r.answer !== undefined || r.handback !== undefined)
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
    figure_work_order: buildFigureWorkOrder(kbRefsUsed),
    integrity_warnings: loadIntegrityReport(),
  };
}

// --------------------------------------------------------------------------- Markdown render

/**
 * The reviewer-facing note per status. Deliberately blunt: this is the line a grant lead skims to
 * decide whether a section is done or still owes work, and to whom.
 */
export const STATUS_NOTE: Readonly<Record<AnswerStatus, string>> = {
  fits: 'Ready to review — within the funder’s limit.',
  ready: 'Ready to review — no stated limit.',
  needs_resize: 'OVER LIMIT — hand back for shortening.',
  compression_infeasible:
    'OVER LIMIT by more than compression can cover — shortening this means dropping facts, and the rewrite must say which.',
  derive_from_reference:
    'NEEDS A SHORT VALUE — the stored answer is narrative; derive the value from it rather than pasting it.',
  needs_attachment: 'STAFF — this field wants a document upload. The text below is the checklist.',
  per_application: 'STAFF — application-specific value. No stored answer exists.',
  needs_review: 'STAFF — low match confidence. Confirm the question or add a variant.',
  kb_gap: 'STAFF — no knowledge base entry. Write one.',
  kb_placeholder: 'STAFF — the knowledge base entry is not real content yet. Supply it.',
};

const BANNER =
  '> **Draft for staff review — not submittable as-is.** Answers come from LaunchPad’s knowledge ' +
  'base, which is a frozen snapshot. Verify every figure against live data before submitting, and ' +
  'edit for this funder’s voice. Sections marked **OVER LIMIT** or **NEEDS A SHORT VALUE** still owe ' +
  'a rewrite; sections marked **STAFF** need a person.';

/**
 * Render one draft package as Markdown: question, answer, provenance footline, outstanding work.
 *
 * This is the artifact a grant lead edits and pastes into the funder's portal. It is never
 * auto-submitted, and the banner says so at the top of every render.
 */
export function renderMarkdown(pkg: DraftPackage): string {
  const meta = pkg.form;
  const L: string[] = [];

  L.push(`# Grant draft — ${meta.funder}`);
  L.push('');
  if (meta.program !== undefined) L.push(`**Program:** ${meta.program}  `);
  if (meta.due !== undefined) L.push(`**Due:** ${meta.due}  `);
  if (meta.framing !== undefined) L.push(`**Framing:** ${meta.framing}  `);
  L.push(`**Questions:** ${String(pkg.summary.total)}  `);
  L.push(
    `**Outstanding:** ${String(pkg.summary.by_actor.llm)} awaiting a rewrite · ` +
      `${String(pkg.summary.by_actor.staff)} awaiting staff  `,
  );
  L.push(
    '**Status counts:** ' +
      Object.entries(pkg.summary.by_status)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(' · '),
  );
  L.push('');
  L.push(BANNER);
  L.push('');
  L.push('---');
  L.push('');

  pkg.results.forEach((r, i) => {
    L.push(`## ${String(i + 1)}. ${r.incoming}`);
    L.push('');
    L.push(`*${STATUS_NOTE[r.status]}*`);
    L.push('');

    if (r.answer !== undefined) {
      L.push(`> ${r.answer.replace(/\n/g, '\n> ')}`);
      L.push('');
    }

    // Source material for an owed rewrite is collapsed, not blockquoted. A `derive_from_reference`
    // field wants a short value — `cover.project_title` is a 30-character "name of your solution"
    // routed to a 199-word program description — and rendering that at full width reads as the
    // answer to anyone skimming.
    if (r.handback !== undefined) {
      const label =
        r.handback.task === 'resize'
          ? `Source text to shorten — ${String(r.measurement?.count)} ${String(r.measurement?.unit)}, NOT submittable at this length`
          : `Source material to derive the value from — NOT the answer to this field`;
      L.push(`<details><summary>${label}</summary>\n\n${r.handback.source_text}\n\n</details>`);
      L.push('');
    }

    const preview = r.measurement?.truncated_preview;
    if (preview !== undefined) {
      L.push(
        `<details><summary>Truncation preview — NOT a resize, and not submittable</summary>\n\n` +
          `${preview}\n\n</details>`,
      );
      L.push('');
    }

    const footline = provenance(r);
    if (footline !== '') {
      L.push(`<sub>${footline}</sub>`);
      L.push('');
    }
    L.push('---');
    L.push('');
  });

  return L.join('\n');
}

/** The provenance and measurement footline for one answer: where it came from and how it measures. */
function provenance(r: AnswerPlan): string {
  const bits: string[] = [];
  if (r.matched_id !== null) bits.push(`canonical \`${r.matched_id}\``);
  if (r.kb_ref !== null) bits.push(`KB \`${r.kb_ref}\``);
  if (r.matched_via !== null) bits.push(`via ${r.matched_via}`);
  bits.push(`match ${r.confidence.toFixed(2)}`);
  if (r.measurement !== undefined) {
    const m = r.measurement;
    bits.push(`length ${String(m.count)} / ${String(m.max)} ${m.unit}`);
    if (!m.fits) bits.push(`**${String(m.ratio)}x over**`);
  }
  if (r.kb_ref !== null && r.verified !== undefined) {
    bits.push(r.verified ? 'grounded in a filed application' : '⚠ not grounded in a filed application');
  }
  if (r.carries_figures === true) bits.push('⚠ carries figures — verify live');
  return bits.join(' · ');
}

/**
 * The compression ceiling, re-exported so a caller reading `compression_infeasible` can name the
 * threshold it crossed without importing `limits.js` as well.
 */
export { MAX_COMPRESSION_RATIO };
