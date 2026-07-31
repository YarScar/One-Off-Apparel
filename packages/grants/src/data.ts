/**
 * data.ts — seed loader and load-time integrity report.
 *
 * Seed JSON is read at runtime with `fs.readFileSync`, not imported as a module. `resolveJsonModule`
 * is off across this repo (only `apps/hq` enables it); turning it on would force the seed into
 * `src/` and make every `tsc`/`eslint` run structurally infer types for 82 questions with 211
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
    throw new Error(`grant seed: cannot read ${path} — ${reason}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`grant seed: ${path} is not valid JSON — ${reason}`);
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

/**
 * Cross-file consistency checks over the writing corpus, computed once. Warnings render alongside
 * results; they never block. Tools echo the relevant slice as `integrity_warnings`.
 */
export function loadIntegrityReport(): readonly IntegrityWarning[] {
  if (integrityCache !== undefined) return integrityCache;

  const out: IntegrityWarning[] = [];
  const bank = loadBank();
  const kb = loadKnowledgeBase();
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

  integrityCache = out;
  return integrityCache;
}
