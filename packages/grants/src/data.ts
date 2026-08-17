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

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every figures.ts and matcher.ts symbol below is read inside computeIntegrityReport() only — never
// at module evaluation — so both import cycles (data -> figures -> data, data -> matcher -> data) are
// safe in either load order. That is the invariant to preserve when adding a check: keep the reads
// function-scoped.
import { normalize } from './matcher.js';
import {
  extractCurrencyClaims,
  statesFigure,
  FIGURE_CHECKS,
  QUESTION_FIGURE_CHECKS,
} from './figures.js';
import {
  incomingFormSchema,
  knowledgeBaseSchema,
  questionBankSchema,
  type IncomingForm,
  type KnowledgeBase,
  type QuestionBank,
} from './schemas.js';

/**
 * The seed directory, resolved relative to this module.
 *
 * `dist/` mirrors `src/`, so `'..'` lands on the package root from either location — `src/data.ts`
 * under vitest and `dist/data.js` at runtime. The invariant holds at any nesting depth; do not move
 * this constant into a subdirectory without adjusting the hop count.
 *
 * In the deployed image this resolves under `packages/grants/`, which the mcp-server Dockerfile
 * runner already copies wholesale (`COPY --from=builder /workspace/packages ./packages`).
 */
export const SEED_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'seed');
export const FORMS_DIR = join(SEED_DIR, 'forms');

export type Severity = 'high' | 'medium' | 'info';

export interface IntegrityWarning {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
}

// --------------------------------------------------------------------------- file reads

interface SafeParser<T> {
  safeParse: (value: unknown) => {
    success: boolean;
    data?: T;
    error?: { issues: { path: (string | number)[]; message: string }[] };
  };
}

function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`grant seed: cannot read ${path} — ${reason}`, { cause: err });
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`grant seed: ${path} is not valid JSON — ${reason}`, { cause: err });
  }
}

function parseSeed<T>(path: string, schema: SafeParser<T>): T {
  const parsed = schema.safeParse(readJson(path));
  if (!parsed.success || parsed.data === undefined) {
    const issues = (parsed.error?.issues ?? [])
      .slice(0, 10)
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`grant seed: ${path} failed validation\n${issues}`);
  }
  return parsed.data;
}

// --------------------------------------------------------------------------- memoised loaders

let bankCache: QuestionBank | undefined;
let kbCache: KnowledgeBase | undefined;
let integrityCache: readonly IntegrityWarning[] | undefined;

export function loadBank(): QuestionBank {
  bankCache ??= parseSeed(join(SEED_DIR, 'questions.json'), questionBankSchema);
  return bankCache;
}

export function loadKnowledgeBase(): KnowledgeBase {
  kbCache ??= parseSeed(join(SEED_DIR, 'kb_launchpad.json'), knowledgeBaseSchema);
  return kbCache;
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
  const out: IntegrityWarning[] = [];
  const kbKeys = new Set(Object.keys(kb.answers));

  // -- kb_entries <-> answers must stay 1:1 ------------------------------------------------
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

  // -- every question's kb_ref must resolve -----------------------------------------------
  const danglingRefs = [
    ...new Set(
      bank.questions
        .map((q) => q.kb_ref)
        .filter((ref): ref is string => ref !== null && !kbKeys.has(ref)),
    ),
  ].sort();
  if (danglingRefs.length > 0) {
    out.push({
      severity: 'high',
      code: 'question_kb_ref_dangling',
      message: `question kb_ref(s) with no KB answer: ${danglingRefs.join(', ')}. Those questions have no stored answer to retrieve.`,
    });
  }

  // -- every structured value's key must name a real question ------------------------------
  // `entry.structured` is keyed by question id (slots are shared — one slot answers many
  // questions). A key that names no question silently falls through to derive_from_reference:
  // the value the lane wrote is never returned and nobody is told why. Renaming or deleting a
  // question in questions.json must not silently orphan its structured value.
  const questionIds = new Set(bank.questions.map((q) => q.id));
  const structuredKeys = [
    ...new Set(
      Object.values(kb.answers).flatMap((a) => Object.keys(a.structured ?? {})),
    ),
  ].sort();
  const danglingStructuredKeys = structuredKeys.filter((qid) => !questionIds.has(qid));
  if (danglingStructuredKeys.length > 0) {
    out.push({
      severity: 'high',
      code: 'structured_key_dangling',
      message:
        `structured value(s) keyed to question id(s) not in questions.json: ` +
        `${danglingStructuredKeys.join(', ')}. Those values can never be returned as an answer and ` +
        `will silently fall through to derive_from_reference. Rename the key or delete the value.`,
    });
  }

  // -- kb refs named in the reconciliation prose -------------------------------------------
  // `meta.connector_reconciliation` is currently the only machine-readable link between the KB and
  // the live connector. Scraping prose is ugly, but letting that link rot silently is exactly the
  // regression the data-honesty rules exist to prevent. The real fix is to promote the field to a
  // structured array — see figures.ts.
  const prose = `${kb.meta.connector_reconciliation} ${kb.meta.source_recency} ${kb.meta.note}`;
  const named = new Set(prose.match(/kb\.[a-z0-9_.]+/g) ?? []);
  const proseDangling = [...named]
    .map((r) => r.replace(/\.$/, ''))
    .filter((r) => !kbKeys.has(r))
    .sort();
  if (proseDangling.length > 0) {
    out.push({
      severity: 'high',
      code: 'kb_ref_dangling_in_prose',
      message:
        `kb_launchpad.json meta references KB slot(s) that do not exist in answers ` +
        `(${String(kbKeys.size)} keys): ${proseDangling.join(', ')}. Any content gap flagged against them ` +
        `is unassigned. Do not create the slot — kb_entries and answers are 1:1.`,
    });
  }

  // -- FIGURE_CHECKS appears_in slots must resolve -----------------------------------------
  // `buildFigureWorkOrder()` scopes by intersecting `appears_in` with the caller's kb_refs, so a
  // slot renamed in kb_launchpad.json silently drops its check from every scoped work order — the
  // draft then publishes the frozen figure with no verification step and no warning, which is the
  // failure figures.ts exists to prevent. Nothing else validates these ids: the checks above cover
  // question kb_refs and the meta prose, not figures.ts. Content-gap checks carry no `appears_in`.
  const danglingFigureRefs = [
    ...new Set(
      FIGURE_CHECKS.flatMap((check) => check.appears_in).filter((ref) => !kbKeys.has(ref)),
    ),
  ].sort();
  if (danglingFigureRefs.length > 0) {
    const affected = FIGURE_CHECKS.filter((c) => c.appears_in.some((r) => !kbKeys.has(r)))
      .map((c) => `${c.key} (${c.severity})`)
      .sort();
    out.push({
      severity: 'high',
      code: 'figure_check_ref_dangling',
      message:
        `FIGURE_CHECKS in figures.ts names KB slot(s) that do not exist in answers: ` +
        `${danglingFigureRefs.join(', ')}. Every scoped work order silently omits the check(s) ` +
        `${affected.join(', ')}, so those frozen figures publish unverified. Fix appears_in in ` +
        `figures.ts to the current slot id — do not create the slot, kb_entries and answers are 1:1.`,
    });
  }

  // -- attachment questions pointing at narrative KB prose --------------------------------
  // An attachment question needs a document, not text, so its stored answer is a checklist of what
  // to attach — never the answer itself. That does not make every kb_ref on an attachment question
  // wrong: ATTACHMENT_SLOTS below are written as exactly that checklist, and routing to one is
  // correct. What this catches is an attachment question pointing at ordinary narrative prose,
  // which would put paragraph text where a funder expects an upload.
  const misroutedAttachments = bank.questions
    .filter(
      (q) =>
        q.answer_type === 'attachment' && q.kb_ref !== null && !ATTACHMENT_SLOTS.has(q.kb_ref),
    )
    .map((q) => q.id)
    .sort();
  if (misroutedAttachments.length > 0) {
    out.push({
      severity: 'medium',
      code: 'attachment_questions_route_to_prose',
      message:
        `${String(misroutedAttachments.length)} question(s) of answer_type 'attachment' route to a ` +
        `narrative KB slot: ${misroutedAttachments.join(', ')}. Those need a document, not text — ` +
        `route them to an attachment checklist slot (${[...ATTACHMENT_SLOTS].sort().join(', ')}) ` +
        `or set kb_ref to null.`,
    });
  }

  // -- QUESTION_FIGURE_CHECKS must resolve on both sides ------------------------------------
  // This map is the whole `fetch_figure` path: `buildAnswer` consults it to decide that a number
  // question gets a LIVE figure instead of the frozen KB value. A key naming a renamed question, or
  // a value naming a renamed check, does not error — the lookup misses, the question quietly takes
  // the normal path, and the draft ships a static number that has already drifted. Nothing else
  // validates it: the checks above cover question kb_refs, meta prose, and FIGURE_CHECKS.appears_in.
  const figureCheckKeys = new Set(FIGURE_CHECKS.map((c) => c.key));
  const badFigureQuestions = Object.keys(QUESTION_FIGURE_CHECKS)
    .filter((qid) => !questionIds.has(qid))
    .sort();
  const badFigureKeys = [
    ...new Set(Object.values(QUESTION_FIGURE_CHECKS).filter((key) => !figureCheckKeys.has(key))),
  ].sort();
  if (badFigureQuestions.length > 0 || badFigureKeys.length > 0) {
    const parts: string[] = [];
    if (badFigureQuestions.length > 0) {
      parts.push(`question id(s) not in questions.json: ${badFigureQuestions.join(', ')}`);
    }
    if (badFigureKeys.length > 0) {
      parts.push(`check key(s) not in FIGURE_CHECKS: ${badFigureKeys.join(', ')}`);
    }
    out.push({
      severity: 'high',
      code: 'question_figure_check_dangling',
      message:
        `QUESTION_FIGURE_CHECKS in figures.ts does not resolve — ${parts.join('; ')}. Those ` +
        `questions silently lose the fetch_figure path and fall back to the frozen KB number, ` +
        `which is the drifted figure the live lookup exists to replace.`,
    });
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
  if (claimGaps.length > 0) {
    out.push({
      severity: 'high',
      code: 'figure_claim_uncovered',
      message:
        `KB slot(s) state a figure whose FIGURE_CHECK does not list them in appears_in: ` +
        `${claimGaps.join('; ')}. A draft built from those slots alone gets no verification item ` +
        `for the figure and publishes it frozen. Add the slot to appears_in in figures.ts.`,
    });
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
  if (newTies.length > 0) {
    out.push({
      severity: 'medium',
      code: 'variant_shared_across_questions',
      message:
        `funder wording(s) recorded against more than one canonical question: ` +
        `${newTies.join('; ')}. An incoming form asking one verbatim scores 1.0 against both and ` +
        `bank order decides the match. Place the wording on one canonical, or record the tie in ` +
        `ACKNOWLEDGED_TIES with the reason.`,
    });
  }

  // -- provenance: every cited source must be declared --------------------------------------
  // `meta.sources` is what makes a recorded wording traceable back to a real funder form. A source
  // id cited by a variant or a limit but never declared breaks that chain, and provenance is the
  // only thing separating the bank from invented questions.
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
  if (undeclaredSources.length > 0) {
    out.push({
      severity: 'medium',
      code: 'variant_source_undeclared',
      message:
        `wordings or limits cite source id(s) not declared in meta.sources ` +
        `(${String(declaredSources.size)} declared): ${undeclaredSources.join(', ')}. Provenance ` +
        `does not resolve for those, so the recorded wording cannot be traced to a real form.`,
    });
  }

  // -- short-value questions left out of a slot that disambiguates its siblings --------------
  // Not "routes to prose" — that is the designed fallback. This is the narrower gap: the slot
  // already carries per-question structured values and this question was missed, so it hands back a
  // paragraph where the funder gave a one-line box. See STRUCTURED_VALUE_DEBT for the known seven.
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
  if (missingStructured.length > 0) {
    out.push({
      severity: 'medium',
      code: 'structured_value_missing',
      message:
        `${String(missingStructured.length)} short-value question(s) route to a KB slot that ` +
        `carries structured values for its other questions but not for these: ` +
        `${missingStructured.join(', ')}. Each returns the slot's full narrative where the funder ` +
        `expects a one-line value. Add a structured value keyed by question id, or record the id ` +
        `in STRUCTURED_VALUE_DEBT with what has to be confirmed first.`,
    });
  }

  // -- question category referential integrity --------------------------------------------
  const categoryIds = new Set(bank.categories.map((c) => c.id));
  const badCategories = [
    ...new Set(bank.questions.map((q) => q.category).filter((c) => !categoryIds.has(c))),
  ].sort();
  if (badCategories.length > 0) {
    out.push({
      severity: 'medium',
      code: 'unknown_question_category',
      message: `questions reference category id(s) not in categories[]: ${badCategories.join(', ')}.`,
    });
  }

  return out;
}

/** {@link computeIntegrityReport} over the seed on disk, computed once. */
export function loadIntegrityReport(): readonly IntegrityWarning[] {
  integrityCache ??= computeIntegrityReport(loadBank(), loadKnowledgeBase());
  return integrityCache;
}
