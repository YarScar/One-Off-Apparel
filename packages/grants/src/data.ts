/**
 * data.ts — seed loader and load-time integrity report.
 *
 * Seed JSON is read at runtime with `fs.readFileSync`, not imported as a module. `resolveJsonModule`
 * is off across this repo (only `apps/hq` enables it); turning it on would force the seed into
 * `src/` and make every `tsc`/`eslint` run structurally infer types for 87 questions with 247
 * nested variants.
 *
 * Loads are lazy and memoised per file, so a malformed seed fails inside a tool call — surfacing as
 * a structured error envelope — rather than crashing server boot.
 *
 * Scope note: this loader reads the three writing inputs only — `questions.json`,
 * `kb_launchpad.json`, and `forms/*.json`. Funder eligibility and fit scoring are another team's
 * scope; their seed corpus is no longer carried here.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// SEED_DIR/FORMS_DIR/readJson/parseSeed moved to seed-io.ts under #8 (WP #333), so figures.ts can
// load figure_checks.json without a value-level cycle back into this module — see seed-io.ts's
// header comment. Re-exported below so nothing importing SEED_DIR/FORMS_DIR from data.ts breaks.
import { SEED_DIR, FORMS_DIR, parseSeed } from './seed-io.js';

// Every figures.ts, slots.ts and matcher.ts symbol below is read inside computeIntegrityReport() only
// — never at module evaluation — so all three import cycles (data -> figures -> data,
// data -> slots -> figures -> data, data -> matcher -> data) are safe in either load order. That is the
// invariant to preserve when adding a check: keep the reads function-scoped. `slots.ts` holds to the
// same rule internally: its only read of FIGURE_CHECKS is inside `checkFor()`.
import { normalize } from './matcher.js';
import {
  extractCurrencyClaims,
  statesFigure,
  FIGURE_CHECKS,
  QUESTION_FIGURE_CHECKS,
} from './figures.js';
import {
  literalFigures,
  malformedSlotTokens,
  unknownSlots,
  unsourcedFigures,
  FIGURE_SLOTS,
} from './slots.js';
import {
  incomingFormSchema,
  knowledgeBaseSchema,
  questionBankSchema,
  testimonialsBankSchema,
  type IncomingForm,
  type KnowledgeBase,
  type QuestionBank,
  type TestimonialsBank,
} from './schemas.js';

export { SEED_DIR, FORMS_DIR } from './seed-io.js';

export type Severity = 'high' | 'medium' | 'info';

export interface IntegrityWarning {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
}

// --------------------------------------------------------------------------- memoised loaders

let bankCache: QuestionBank | undefined;
let kbCache: KnowledgeBase | undefined;
let testimonialsCache: TestimonialsBank | undefined;
let integrityCache: readonly IntegrityWarning[] | undefined;

export function loadBank(): QuestionBank {
  bankCache ??= parseSeed(join(SEED_DIR, 'questions.json'), questionBankSchema);
  return bankCache;
}

export function loadKnowledgeBase(): KnowledgeBase {
  kbCache ??= parseSeed(join(SEED_DIR, 'kb_launchpad.json'), knowledgeBaseSchema);
  return kbCache;
}

/**
 * Testimonials/quotes bank — candidate material for a narrative section, NOT a KB-slot answer. No
 * `questions.json` id routes here: a funder question rarely asks for a testimonial verbatim, so
 * pulling one is a drafting choice a caller makes explicitly, filtered by role/school/cohort, rather
 * than something `buildAnswer` retrieves automatically. See `schemas.ts`'s `testimonialSchema` doc.
 */
export function loadTestimonials(): TestimonialsBank {
  testimonialsCache ??= parseSeed(join(SEED_DIR, 'testimonials.json'), testimonialsBankSchema);
  return testimonialsCache;
}

/** Form fixture ids, discovered from `seed/forms/` so the list can never drift from disk. */
export function listFormIds(): string[] {
  return readdirSync(FORMS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** Load a form by fixture id (`aug7_truist`) or by filesystem path. */
export function loadForm(idOrPath: string): IncomingForm {
  const path = idOrPath.endsWith('.json') ? idOrPath : join(FORMS_DIR, `${idOrPath}.json`);
  return parseSeed(path, incomingFormSchema);
}

/** Reset every memoised seed read. Mirrors `resetClient()` in `packages/embedding`. */
export function __resetSeedCacheForTesting(): void {
  bankCache = undefined;
  kbCache = undefined;
  testimonialsCache = undefined;
  integrityCache = undefined;
}

// --------------------------------------------------------------------------- integrity checks

/**
 * KB slots whose stored answer is a checklist of documents to attach rather than prose to submit.
 * An `answer_type: 'attachment'` question may route to one of these; routing to anything else is a
 * defect. Keep this list short — a slot belongs here only if its text tells staff what to upload.
 */
const ATTACHMENT_SLOTS: ReadonlySet<string> = new Set(['kb.docs', 'kb.budget_narrative']);

/** Two question ids joined by `|` in sorted order — the key shape for {@link ACKNOWLEDGED_TIES}. */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/**
 * Funder wordings that legitimately sit on two canonical questions at once.
 *
 * A wording recorded against two canonicals is a matcher tie: an incoming form asking it verbatim
 * scores 1.0 against both, and which one wins is bank order. That is the confident-wrong-match class
 * board B6 pinned by hand and v0.4.0 avoided by placing the WPF "Project description" wording on
 * exactly one canonical.
 *
 * These three are recorded rather than resolved, because resolving one means moving a real funder
 * wording, which changes matcher output and obliges a parity regeneration against the prototype —
 * see `../CHANGELOG.md`. Each is a genuinely two-part ask that the bank splits, so neither
 * destination is wrong; the tie is in the source form, not in the bank. **This is a debt register,
 * not an approval list.** Removing an entry once the wording is placed is the fix; adding one is
 * taking on debt and needs the same reasoning written down.
 */
const ACKNOWLEDGED_TIES: ReadonlyMap<string, string> = new Map([
  [
    pairKey('organization.mission', 'organization.history'),
    "Instrumentl asks mission and history in one sentence; the bank splits them and both halves are answerable.",
  ],
  [
    pairKey('organization.demographics', 'attachments.board_list'),
    'NNG asks for the board list AND its demographics — one is an upload, one is a narrative.',
  ],
  [
    pairKey('program.target_population', 'program.jobs_and_participants'),
    'FFTC asks how many people will be impacted: a population question and a count question at once.',
  ],
]);

/**
 * Non-narrative questions knowingly answered from prose, on a slot that disambiguates other
 * questions with a structured value but not this one.
 *
 * Routing a `field` or `single_select` question to a narrative slot is not itself a defect — the
 * tools label that prose reference material rather than an answer, which is the designed fallback
 * (`schemas.ts::NON_NARRATIVE_ANSWER_TYPES`). What this register tracks is narrower and is a real
 * gap: the slot was *already* set up with per-question structured values, and these questions were
 * left out. `cover.legal_name` returns the 778-character `kb.profile.identity` paragraph where a
 * funder wants one line.
 *
 * They are listed rather than filled because the values are organisational facts this layer must not
 * invent — `CLAUDE.md` "Do not invent". `kb.profile.identity` says so itself: "Still to confirm
 * before applying: Launchpad's own registered legal name/EIN". Filling one is the fix; the check
 * below fires on any NEW question that falls into the same gap.
 */
const STRUCTURED_VALUE_DEBT: ReadonlySet<string> = new Set([
  'cover.authorized_rep', // field -> kb.profile.contacts
  'cover.fiscal_year', // field -> kb.profile.identity
  'cover.legal_name', // field -> kb.profile.identity
  'cover.year_founded', // field -> kb.profile.identity
  'eligibility.debarment', // boolean -> kb.eligibility
  'eligibility.minority_owned', // single_select -> kb.eligibility
  'eligibility.prior_funding', // single_select -> kb.eligibility
]);

/** Answer types that want a short value, not a paragraph. Mirrors `schemas.ts`, minus attachment. */
const SHORT_VALUE_TYPES: ReadonlySet<string> = new Set([
  'field',
  'number',
  'boolean',
  'single_select',
  'multi_select',
  'demographic',
]);

/**
 * A single cross-file consistency check over the writing corpus. Each is independent — none reads
 * another's output, none depends on the others having run first — so {@link computeIntegrityReport}
 * runs the whole list through `.flatMap`. `kbKeys` is threaded in rather than recomputed per check
 * because most of them need it and `Object.keys(kb.answers)` is otherwise repeated verbatim.
 */
type IntegrityCheck = (
  bank: QuestionBank,
  kb: KnowledgeBase,
  kbKeys: ReadonlySet<string>,
) => readonly IntegrityWarning[];

// -- kb_entries <-> answers must stay 1:1 ------------------------------------------------
function checkKbEntryAnswerParity(
  bank: QuestionBank,
  kb: KnowledgeBase,
  kbKeys: ReadonlySet<string>,
): readonly IntegrityWarning[] {
  const out: IntegrityWarning[] = [];
  const entryIds = new Set(bank.kb_entries.map((e) => e.id));
  const missingAnswers = [...entryIds].filter((id) => !kbKeys.has(id)).sort();
  const orphanAnswers = [...kbKeys].filter((id) => !entryIds.has(id)).sort();
  if (missingAnswers.length > 0) {
    out.push({
      severity: 'high',
      code: 'kb_entry_without_answer',
      message: `questions.json declares KB slot(s) with no answer in kb_launchpad.json: ${missingAnswers.join(', ')}.`,
    });
  }
  if (orphanAnswers.length > 0) {
    out.push({
      severity: 'info',
      code: 'kb_answer_without_entry',
      message: `kb_launchpad.json has answer(s) not declared in questions.json kb_entries: ${orphanAnswers.join(', ')}.`,
    });
  }
  return out;
}

// -- every question's kb_ref must resolve -----------------------------------------------
function checkQuestionKbRefDangling(
  bank: QuestionBank,
  _kb: KnowledgeBase,
  kbKeys: ReadonlySet<string>,
): readonly IntegrityWarning[] {
  const danglingRefs = [
    ...new Set(
      bank.questions
        .map((q) => q.kb_ref)
        .filter((ref): ref is string => ref !== null && !kbKeys.has(ref)),
    ),
  ].sort();
  if (danglingRefs.length === 0) return [];
  return [
    {
      severity: 'high',
      code: 'question_kb_ref_dangling',
      message: `question kb_ref(s) with no KB answer: ${danglingRefs.join(', ')}. Those questions have no stored answer to retrieve.`,
    },
  ];
}

// -- every structured value's key must name a real question ------------------------------
// `entry.structured` is keyed by question id (slots are shared — one slot answers many
// questions). A key that names no question silently falls through to derive_from_reference:
// the value the lane wrote is never returned and nobody is told why. Renaming or deleting a
// question in questions.json must not silently orphan its structured value.
function checkStructuredKeyDangling(
  bank: QuestionBank,
  kb: KnowledgeBase,
): readonly IntegrityWarning[] {
  const questionIds = new Set(bank.questions.map((q) => q.id));
  const structuredKeys = [
    ...new Set(Object.values(kb.answers).flatMap((a) => Object.keys(a.structured ?? {}))),
  ].sort();
  const danglingStructuredKeys = structuredKeys.filter((qid) => !questionIds.has(qid));
  if (danglingStructuredKeys.length === 0) return [];
  return [
    {
      severity: 'high',
      code: 'structured_key_dangling',
      message:
        `structured value(s) keyed to question id(s) not in questions.json: ` +
        `${danglingStructuredKeys.join(', ')}. Those values can never be returned as an answer and ` +
        `will silently fall through to derive_from_reference. Rename the key or delete the value.`,
    },
  ];
}

// -- kb refs named in meta prose -----------------------------------------------------------
// Scraping prose is ugly, but letting a dangling reference in staff-facing meta text rot silently
// is exactly the regression the data-honesty rules exist to prevent.
//
// `meta.connector_reconciliation` used to be scanned here too. It carried the same kind of stale-
// figure risk `stored_literal_figure` guards against for `kb.answers`, but outside that scan's
// loop — WP #322 removed it from the KB entirely rather than extend this scan to cover it: it's
// relocated, dated, to `docs/connector-reconciliation-notes.md`, which no code path reads.
function checkKbRefDanglingInProse(
  _bank: QuestionBank,
  kb: KnowledgeBase,
  kbKeys: ReadonlySet<string>,
): readonly IntegrityWarning[] {
  const prose = `${kb.meta.source_recency} ${kb.meta.note}`;
  const named = new Set(prose.match(/kb\.[a-z0-9_.]+/g) ?? []);
  const proseDangling = [...named]
    .map((r) => r.replace(/\.$/, ''))
    .filter((r) => !kbKeys.has(r))
    .sort();
  if (proseDangling.length === 0) return [];
  return [
    {
      severity: 'high',
      code: 'kb_ref_dangling_in_prose',
      message:
        `kb_launchpad.json meta references KB slot(s) that do not exist in answers ` +
        `(${String(kbKeys.size)} keys): ${proseDangling.join(', ')}. Any content gap flagged against them ` +
        `is unassigned. Do not create the slot — kb_entries and answers are 1:1.`,
    },
  ];
}

// -- FIGURE_CHECKS appears_in slots must resolve -----------------------------------------
// `buildFigureWorkOrder()` scopes by intersecting `appears_in` with the caller's kb_refs, so a
// slot renamed in kb_launchpad.json silently drops its check from every scoped work order — the
// draft then publishes the frozen figure with no verification step and no warning, which is the
// failure figures.ts exists to prevent. Nothing else validates these ids: the checks above cover
// question kb_refs and the meta prose, not figures.ts. Content-gap checks carry no `appears_in`.
function checkFigureCheckRefDangling(
  _bank: QuestionBank,
  _kb: KnowledgeBase,
  kbKeys: ReadonlySet<string>,
): readonly IntegrityWarning[] {
  const danglingFigureRefs = [
    ...new Set(FIGURE_CHECKS.flatMap((check) => check.appears_in).filter((ref) => !kbKeys.has(ref))),
  ].sort();
  if (danglingFigureRefs.length === 0) return [];
  const affected = FIGURE_CHECKS.filter((c) => c.appears_in.some((r) => !kbKeys.has(r)))
    .map((c) => `${c.key} (${c.severity})`)
    .sort();
  return [
    {
      severity: 'high',
      code: 'figure_check_ref_dangling',
      message:
        `FIGURE_CHECKS in figures.ts names KB slot(s) that do not exist in answers: ` +
        `${danglingFigureRefs.join(', ')}. Every scoped work order silently omits the check(s) ` +
        `${affected.join(', ')}, so those frozen figures publish unverified. Fix appears_in in ` +
        `figures.ts to the current slot id — do not create the slot, kb_entries and answers are 1:1.`,
    },
  ];
}

// -- attachment questions pointing at narrative KB prose --------------------------------
// An attachment question needs a document, not text, so its stored answer is a checklist of what
// to attach — never the answer itself. That does not make every kb_ref on an attachment question
// wrong: ATTACHMENT_SLOTS below are written as exactly that checklist, and routing to one is
// correct. What this catches is an attachment question pointing at ordinary narrative prose,
// which would put paragraph text where a funder expects an upload.
function checkAttachmentQuestionsRouteToProse(bank: QuestionBank): readonly IntegrityWarning[] {
  const misroutedAttachments = bank.questions
    .filter(
      (q) => q.answer_type === 'attachment' && q.kb_ref !== null && !ATTACHMENT_SLOTS.has(q.kb_ref),
    )
    .map((q) => q.id)
    .sort();
  if (misroutedAttachments.length === 0) return [];
  return [
    {
      severity: 'medium',
      code: 'attachment_questions_route_to_prose',
      message:
        `${String(misroutedAttachments.length)} question(s) of answer_type 'attachment' route to a ` +
        `narrative KB slot: ${misroutedAttachments.join(', ')}. Those need a document, not text — ` +
        `route them to an attachment checklist slot (${[...ATTACHMENT_SLOTS].sort().join(', ')}) ` +
        `or set kb_ref to null.`,
    },
  ];
}

// -- QUESTION_FIGURE_CHECKS must resolve on both sides ------------------------------------
// This map is the whole `fetch_figure` path: `buildAnswer` consults it to decide that a number
// question gets a LIVE figure instead of the frozen KB value. A key naming a renamed question, or
// a value naming a renamed check, does not error — the lookup misses, the question quietly takes
// the normal path, and the draft ships a static number that has already drifted. Nothing else
// validates it: the checks above cover question kb_refs, meta prose, and FIGURE_CHECKS.appears_in.
function checkQuestionFigureCheckDangling(bank: QuestionBank): readonly IntegrityWarning[] {
  const questionIds = new Set(bank.questions.map((q) => q.id));
  const figureCheckKeys = new Set(FIGURE_CHECKS.map((c) => c.key));
  const badFigureQuestions = Object.keys(QUESTION_FIGURE_CHECKS)
    .filter((qid) => !questionIds.has(qid))
    .sort();
  const badFigureKeys = [
    ...new Set(Object.values(QUESTION_FIGURE_CHECKS).filter((key) => !figureCheckKeys.has(key))),
  ].sort();
  if (badFigureQuestions.length === 0 && badFigureKeys.length === 0) return [];
  const parts: string[] = [];
  if (badFigureQuestions.length > 0) {
    parts.push(`question id(s) not in questions.json: ${badFigureQuestions.join(', ')}`);
  }
  if (badFigureKeys.length > 0) {
    parts.push(`check key(s) not in FIGURE_CHECKS: ${badFigureKeys.join(', ')}`);
  }
  return [
    {
      severity: 'high',
      code: 'question_figure_check_dangling',
      message:
        `QUESTION_FIGURE_CHECKS in figures.ts does not resolve — ${parts.join('; ')}. Those ` +
        `questions silently lose the fetch_figure path and fall back to the frozen KB number, ` +
        `which is the drifted figure the live lookup exists to replace.`,
    },
  ];
}

// -- every slot carrying a figure claim must be declared on its check ---------------------
// The inverse of figure_check_ref_dangling above. That one asks whether every declared slot
// exists; this asks whether every slot carrying the claim gets declared. Both failures are silent
// for the same reason — `buildFigureWorkOrder()` scopes by `appears_in` — but this one is the
// commoner edit: a figure gets restated in a new slot and nobody updates figures.ts.
//
// Currency tokens only. See `extractCurrencyClaims` for the measured reason percentages are out.
//
// Structured values are scanned alongside `text` because they are answers in their own right —
// `eligibility.budget_size` hands a funder "FY2025 expenses ~$1.34M" with no prose around it, so a
// figure restated only there needs the same verification item as one restated in a paragraph.
function checkFigureClaimUncovered(_bank: QuestionBank, kb: KnowledgeBase): readonly IntegrityWarning[] {
  const claimGaps: string[] = [];
  for (const check of FIGURE_CHECKS) {
    const tokens = extractCurrencyClaims(check.claim);
    if (tokens.length === 0) continue;
    const undeclared = Object.entries(kb.answers)
      .filter(([slot]) => !check.appears_in.includes(slot))
      .filter(([, answer]) => {
        const texts = [answer.text, ...Object.values(answer.structured ?? {}).map((s) => s.value)];
        return tokens.some((t) => texts.some((text) => statesFigure(text, t)));
      })
      .map(([slot]) => slot)
      .sort();
    if (undeclared.length > 0) {
      claimGaps.push(`${check.key} -> ${undeclared.join(', ')}`);
    }
  }
  if (claimGaps.length === 0) return [];
  return [
    {
      severity: 'high',
      code: 'figure_claim_uncovered',
      message:
        `KB slot(s) state a figure whose FIGURE_CHECK does not list them in appears_in: ` +
        `${claimGaps.join('; ')}. A draft built from those slots alone gets no verification item ` +
        `for the figure and publishes it frozen. Add the slot to appears_in in figures.ts.`,
    },
  ];
}

// -- the language-only rule: no stored figure without a slot or a recorded exemption -------
// The check that makes `slots.ts` a rule rather than a convention. A figure left literal in stored
// prose is a number that publishes without verification — the sentence reads as an answer, so a
// draft that skips the work ships it looking finished. That is the failure the whole slot mechanism
// exists to make impossible, and without this check the mechanism only covers the sentences someone
// remembered to convert.
//
// Structured values are scanned alongside `text` for the same reason `figure_claim_uncovered` scans
// them: they are answers in their own right, and a figure restated only there ships with no prose
// around it to make its staleness visible.
//
// `IMMUTABLE_FIGURES` is what keeps this from firing on the organisation's own name — `Building 21`
// is in 15 of 29 slots — and every exemption there carries its reason. A new hit is fixed by
// slotting the figure, not by widening the allowlist.
function checkStoredLiteralFigure(_bank: QuestionBank, kb: KnowledgeBase): readonly IntegrityWarning[] {
  const literalHits: string[] = [];
  for (const [slot, answer] of Object.entries(kb.answers)) {
    const texts: [string, string][] = [
      ['text', answer.text],
      ...Object.entries(answer.structured ?? {}).map(
        ([qid, s]): [string, string] => [`structured.${qid}`, s.value],
      ),
    ];
    for (const [where, value] of texts) {
      const found = literalFigures(value);
      if (found.length > 0) literalHits.push(`${slot}.${where}: ${found.join(', ')}`);
    }
  }
  if (literalHits.length === 0) return [];
  return [
    {
      severity: 'high',
      code: 'stored_literal_figure',
      message:
        `Stored answers hold literal figure(s) with no slot and no recorded exemption: ` +
        `${literalHits.join('; ')}. Committed artifacts store language — replace each with a ` +
        `{{slot}} from FIGURE_SLOTS in slots.ts so it is filled live, or, only if the figure has no ` +
        `live source and does not drift, add the phrase to IMMUTABLE_FIGURES with the reason.`,
    },
  ];
}

// -- figures that drift with nothing to fill them from ------------------------------------
// Separate from the `high` violation above, and separately severe, because it is a different problem
// with a different owner. A `stored_literal_figure` hit is fixed by whoever is editing the corpus:
// slot it. A hit here cannot be fixed in the corpus at all — the number moves and the platform holds
// nothing to move it from — so it is raised at `medium` and carries what would settle it, which is
// usually a connector or a staff decision rather than an edit.
//
// Reported every load rather than recorded once in a document, because this is the register most
// likely to be quietly outgrown: the day a connector starts holding outreach contacts, the entry
// should become a slot, and nothing else in the system will notice.
function checkStoredFigureUnsourced(_bank: QuestionBank, kb: KnowledgeBase): readonly IntegrityWarning[] {
  const unsourcedHits: string[] = [];
  for (const [slot, answer] of Object.entries(kb.answers)) {
    const texts = [answer.text, ...Object.values(answer.structured ?? {}).map((s) => s.value)];
    const found = [...new Set(texts.flatMap((t) => unsourcedFigures(t)))];
    for (const d of found) {
      unsourcedHits.push(`${slot}: ${d.why_not_a_slot} Would settle it: ${d.would_settle_it}`);
    }
  }
  if (unsourcedHits.length === 0) return [];
  return [
    {
      severity: 'medium',
      code: 'stored_figure_unsourced',
      message:
        `${String(unsourcedHits.length)} stored figure(s) drift with no live source to fill them from, ` +
        `so they stay literal and are recorded in FIGURE_DEBT rather than slotted: ` +
        `${unsourcedHits.join(' | ')}. Verify each by hand before publishing, and do not read the ` +
        `absence of a {{slot}} as confirmation that the figure is current.`,
    },
  ];
}

// -- every slot token must name a real slot -----------------------------------------------
// A misspelled slot id is the worst failure available to this mechanism, because it fails in the
// permissive direction twice over: `resolveSlots()` drops the unknown id, so the gate does not fire,
// so the text is returned as a finished answer — with `{{wages_totl}}` still in it. Neither a
// reviewer nor the calling model is told anything. Caught here, at load, where the corpus is fixable.
function checkFigureSlotUnknown(_bank: QuestionBank, kb: KnowledgeBase): readonly IntegrityWarning[] {
  const slotHits: string[] = [];
  for (const [slot, answer] of Object.entries(kb.answers)) {
    const texts = [answer.text, ...Object.values(answer.structured ?? {}).map((s) => s.value)];
    for (const value of texts) {
      const bad = [...unknownSlots(value), ...malformedSlotTokens(value)];
      if (bad.length > 0) slotHits.push(`${slot}: ${bad.join(', ')}`);
    }
  }
  if (slotHits.length === 0) return [];
  return [
    {
      severity: 'high',
      code: 'figure_slot_unknown',
      message:
        `Stored answers reference slot token(s) that FIGURE_SLOTS does not define: ` +
        `${slotHits.join('; ')}. An unknown token does not block the draft — it is dropped, the ` +
        `answer is returned as finished, and the raw token goes out in the text. Fix the id or add ` +
        `the slot to slots.ts.`,
    },
  ];
}

// -- every live slot must name a check that resolves ---------------------------------------
// The registry checking itself. A `live` slot whose `check` names nothing produces a requirement
// with no `tool`, which blocks the draft while telling the caller nothing about how to unblock it —
// strictly worse than having left the figure literal.
function checkFigureSlotUnresolved(): readonly IntegrityWarning[] {
  const checkKeys = new Set(FIGURE_CHECKS.map((c) => c.key));
  const unresolvedSlots = Object.entries(FIGURE_SLOTS)
    .filter(([, s]) => s.kind === 'live' && (s.check === undefined || !checkKeys.has(s.check)))
    .map(([id, s]) => `${id} -> ${s.check ?? '(none)'}`)
    .sort();
  if (unresolvedSlots.length === 0) return [];
  return [
    {
      severity: 'high',
      code: 'figure_slot_unresolved',
      message:
        `FIGURE_SLOTS declares live slot(s) whose FIGURE_CHECKS key does not resolve: ` +
        `${unresolvedSlots.join('; ')}. Those slots block every draft that uses them and name no call ` +
        `to unblock them. Point each at a real check key in figures.ts.`,
    },
  ];
}

// -- funder wordings recorded against more than one canonical -----------------------------
// A duplicated wording scores 1.0 against both canonicals, so bank order decides the match. See
// ACKNOWLEDGED_TIES for the three that are known and why they are not resolved here.
//
// The key is `matcher.normalize()`, not a local approximation of it: what counts as "the same
// wording" here has to be what the matcher counts as the same, or the check misses exactly the
// collisions it exists to catch. A local `[^a-z0-9 ] -> ''` made "Program/project description"
// and "Program project description" different keys while the matcher tied them at 1.0.
//
// Canonicals are indexed alongside variants because `candidatesFor()` scores the canonical text as
// a candidate too, so a variant matching another question's canonical ties the same way.
function checkVariantSharedAcrossQuestions(bank: QuestionBank): readonly IntegrityWarning[] {
  const byWording = new Map<string, Set<string>>();
  for (const q of bank.questions) {
    for (const text of [q.canonical, ...q.variants.map((v) => v.text)]) {
      const key = normalize(text).join(' ');
      if (key === '') continue;
      const seen = byWording.get(key) ?? new Set<string>();
      seen.add(q.id);
      byWording.set(key, seen);
    }
  }
  const newTies = [...byWording.values()]
    .filter((ids) => ids.size > 1)
    .map((ids) => [...ids].sort())
    .filter((ids) => {
      const [a, b] = ids;
      if (ids.length !== 2 || a === undefined || b === undefined) return true;
      return !ACKNOWLEDGED_TIES.has(pairKey(a, b));
    })
    .map((ids) => ids.join(' + '))
    .sort();
  if (newTies.length === 0) return [];
  return [
    {
      severity: 'medium',
      code: 'variant_shared_across_questions',
      message:
        `funder wording(s) recorded against more than one canonical question: ` +
        `${newTies.join('; ')}. An incoming form asking one verbatim scores 1.0 against both and ` +
        `bank order decides the match. Place the wording on one canonical, or record the tie in ` +
        `ACKNOWLEDGED_TIES with the reason.`,
    },
  ];
}

// -- provenance: every cited source must be declared --------------------------------------
// `meta.sources` is what makes a recorded wording traceable back to a real funder form. A source
// id cited by a variant or a limit but never declared breaks that chain, and provenance is the
// only thing separating the bank from invented questions.
function checkVariantSourceUndeclared(bank: QuestionBank): readonly IntegrityWarning[] {
  const declaredSources = new Set(bank.meta.sources.map((s) => s.id));
  const undeclaredSources = [
    ...new Set(
      bank.questions.flatMap((q) => [
        ...q.variants.map((v) => v.source),
        ...(q.limits ?? []).map((l) => l.source),
      ]),
    ),
  ]
    .filter((s) => !declaredSources.has(s))
    .sort();
  if (undeclaredSources.length === 0) return [];
  return [
    {
      severity: 'medium',
      code: 'variant_source_undeclared',
      message:
        `wordings or limits cite source id(s) not declared in meta.sources ` +
        `(${String(declaredSources.size)} declared): ${undeclaredSources.join(', ')}. Provenance ` +
        `does not resolve for those, so the recorded wording cannot be traced to a real form.`,
    },
  ];
}

// -- short-value questions left out of a slot that disambiguates its siblings --------------
// Not "routes to prose" — that is the designed fallback. This is the narrower gap: the slot
// already carries per-question structured values and this question was missed, so it hands back a
// paragraph where the funder gave a one-line box. See STRUCTURED_VALUE_DEBT for the known seven.
function checkStructuredValueMissing(bank: QuestionBank, kb: KnowledgeBase): readonly IntegrityWarning[] {
  const missingStructured = bank.questions
    .filter((q) => SHORT_VALUE_TYPES.has(q.answer_type) && q.kb_ref !== null)
    .filter((q) => !STRUCTURED_VALUE_DEBT.has(q.id))
    .filter((q) => {
      const ref = q.kb_ref;
      if (ref === null) return false;
      const structured = kb.answers[ref]?.structured;
      // `structured: {}` is not "carries structured values" — reading it that way would flag every
      // short-value question on a slot the moment its last structured value is removed.
      if (structured === undefined || Object.keys(structured).length === 0) return false;
      return !(q.id in structured);
    })
    .map((q) => q.id)
    .sort();
  if (missingStructured.length === 0) return [];
  return [
    {
      severity: 'medium',
      code: 'structured_value_missing',
      message:
        `${String(missingStructured.length)} short-value question(s) route to a KB slot that ` +
        `carries structured values for its other questions but not for these: ` +
        `${missingStructured.join(', ')}. Each returns the slot's full narrative where the funder ` +
        `expects a one-line value. Add a structured value keyed by question id, or record the id ` +
        `in STRUCTURED_VALUE_DEBT with what has to be confirmed first.`,
    },
  ];
}

// -- testimonials de-identification is machine-enforced, not just documented -------------
// The whole reason the testimonials bank exists de-identified: `grant-writing-mcp/SKILL.md` Step 5's
// consent gate says never name a participant without documented consent. A student row carrying a
// name with no `consent_on_file` would silently ship a real student's name in a draft the moment
// someone widened what a caller reads off a quote — this makes that a load-time failure instead of a
// documentation promise. `attribution` is fine on non-student rows (employer/other/client are
// professional attributions, not student PII) regardless of `consent_on_file`.
function checkTestimonialDeidentification(): readonly IntegrityWarning[] {
  const testimonials = loadTestimonials();
  const violations = testimonials.quotes
    .filter((q) => q.role === 'student' && q.attribution !== null && !q.consent_on_file)
    .map((q) => q.id)
    .sort();
  if (violations.length === 0) return [];
  return [
    {
      severity: 'high',
      code: 'testimonial_student_deidentification',
      message:
        `testimonials.json has student-role quote(s) with a name attached and no consent on file: ` +
        `${violations.join(', ')}. Set attribution to null, or set consent_on_file:true only once a ` +
        `documented consent exists for that student.`,
    },
  ];
}

// -- question category referential integrity --------------------------------------------
function checkUnknownQuestionCategory(bank: QuestionBank): readonly IntegrityWarning[] {
  const categoryIds = new Set(bank.categories.map((c) => c.id));
  const badCategories = [
    ...new Set(bank.questions.map((q) => q.category).filter((c) => !categoryIds.has(c))),
  ].sort();
  if (badCategories.length === 0) return [];
  return [
    {
      severity: 'medium',
      code: 'unknown_question_category',
      message: `questions reference category id(s) not in categories[]: ${badCategories.join(', ')}.`,
    },
  ];
}

/** Every check {@link computeIntegrityReport} runs, in the order warnings are reported. */
const INTEGRITY_CHECKS: readonly IntegrityCheck[] = [
  checkKbEntryAnswerParity,
  checkQuestionKbRefDangling,
  checkStructuredKeyDangling,
  checkKbRefDanglingInProse,
  checkFigureCheckRefDangling,
  checkAttachmentQuestionsRouteToProse,
  checkQuestionFigureCheckDangling,
  checkFigureClaimUncovered,
  checkStoredLiteralFigure,
  checkStoredFigureUnsourced,
  checkFigureSlotUnknown,
  checkFigureSlotUnresolved,
  checkVariantSharedAcrossQuestions,
  checkVariantSourceUndeclared,
  checkStructuredValueMissing,
  checkUnknownQuestionCategory,
  checkTestimonialDeidentification,
];

/**
 * Cross-file consistency checks over the writing corpus. Warnings render alongside results; they
 * never block. Tools echo the relevant slice as `integrity_warnings`.
 *
 * Separate from {@link loadIntegrityReport} so the checks can be exercised on a corpus that actually
 * has the defect. Asserting the report is empty on the real seed proves the seed is clean; it proves
 * nothing about the checker, and a check that has silently stopped firing looks exactly like a clean
 * seed from the outside.
 */
export function computeIntegrityReport(
  bank: QuestionBank,
  kb: KnowledgeBase,
): readonly IntegrityWarning[] {
  const kbKeys = new Set(Object.keys(kb.answers));
  return INTEGRITY_CHECKS.flatMap((check) => check(bank, kb, kbKeys));
}

/** {@link computeIntegrityReport} over the seed on disk, computed once. */
export function loadIntegrityReport(): readonly IntegrityWarning[] {
  integrityCache ??= computeIntegrityReport(loadBank(), loadKnowledgeBase());
  return integrityCache;
}
