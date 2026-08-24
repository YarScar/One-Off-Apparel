import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DEFAULT_THRESHOLD,
  FRAMINGS,
  incomingFormSchema,
  listFormIds,
  loadBank,
  loadForm,
  loadKnowledgeBase,
  renderMarkdown,
  runPipeline,
  STATUS_ACTOR,
  type Actor,
  type AnswerStatus,
  type DraftPackage,
} from '@lp-ai/lib-grants';

import { runTool, parseNum, parseStr } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'grant_build_draft';

const DESCRIPTION =
  'Resolve a captured funder application form into a reviewable draft package, so you do not rewrite ' +
  'answers LaunchPad has already written and approved. For each question: match it to the LaunchPad ' +
  'question bank, retrieve the mapped knowledge-base answer, and measure it against the funder’s ' +
  'stated length limit. Returns per-question answer plans, a Markdown draft, and a FIGURE WORK ORDER ' +
  '— the exact query_* calls to run to verify every figure. Deterministic: no model, no database, no ' +
  'network. Where a stored answer does not drop straight into a field — over the limit, or a short ' +
  'field whose stored answer is narrative — the result carries a `handback` with the source text, the ' +
  'limit, the measurement, and the rules, and YOU do that rewrite: see `your_tasks`. `staff_actions` ' +
  'is what needs a person instead. Nothing it returns is submittable as-is. This pipeline — not ' +
  '`skill_grant_writing`\'s freehand drafting — is the canonical, fabrication-preventing path for a ' +
  'captured funder form; use `skill_grant_writing` only when this tool is unavailable.';

const limitSchema = z.object({
  unit: z.enum(['words', 'characters', 'chars', 'sentences']),
  max: z.number().int().positive(),
});

/**
 * The stored fixture names, for the `form_id` description — or nothing, if the seed is unreadable.
 *
 * The try/catch is load-bearing. `inputSchema` is evaluated when this module is imported, and
 * `listFormIds()` does a `readdirSync` on `packages/grants/seed/forms`. An unguarded throw there
 * happens while `make-server.ts` is still importing, which takes down all 24 tools rather than
 * degrading one — the opposite of the lazy-load invariant `packages/grants/src/data.ts` documents.
 * It works today only because the Dockerfile copies `packages/` wholesale, and `.dockerignore`
 * already excludes two `packages/grants/*` paths.
 */
function describeFormIds(): string {
  try {
    const ids = listFormIds();
    return ids.length === 0 ? '' : ` One of: ${ids.join(', ')}.`;
  } catch {
    return '';
  }
}

const inputSchema = {
  funder: z
    .string()
    .optional()
    .describe("The funder's name. Required when passing `questions`."),
  questions: z
    .array(
      z.object({
        text: z.string().min(1).describe('The question, worded exactly as the funder words it.'),
        limit: limitSchema
          .optional()
          .describe("The funder's stated length limit for this question, if it states one."),
      }),
    )
    .max(200)
    .optional()
    .describe('The captured form. Results come back in this order.'),
  program: z
    .string()
    .optional()
    .describe(
      'Which program or entity this application is for — e.g. "101", "LiftOff", or "Inc." Required: ' +
        'ask which applies rather than assume.',
    ),
  due: z.string().optional().describe('The deadline, as the funder states it.'),
  framing: z
    .enum(FRAMINGS)
    .optional()
    .describe(
      'The fiscal-sponsorship framing to use with this funder — `initiative` (Launchpad as an ' +
        'initiative of Building 21, emphasising institutional backing), `fiscal_sponsorship` (the ' +
        'formal fiscally sponsored structure), or `silent` (focus on Launchpad, no detail on the ' +
        'Building 21 relationship). Required: ask which applies every time, never assume.',
    ),
  form_id: z
    .string()
    .optional()
    .describe(
      `Instead of passing questions, run a stored form fixture.${describeFormIds()}`,
    ),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      `Match confidence floor. Defaults to ${String(DEFAULT_THRESHOLD)}, the value used for LaunchPad's filed applications.`,
    ),
  include_markdown: z
    .boolean()
    .optional()
    .describe('Include the rendered Markdown draft. Defaults to true. Set false for the data only.'),
};

/**
 * What each status needs next. `null` means nothing is owed — the two `actor: 'none'` statuses.
 *
 * **Keyed on `AnswerStatus`, and that is the whole point of the type annotation.** This was two
 * separate `Record<string, string>` maps, hand-split by actor, and `outstanding()` iterates the map's
 * own keys — so a status missing from both maps was silently absent from both work lists while still
 * counting toward `by_actor`. Three were: `fetch_figure` and `needs_expand` (`llm`) and
 * `figure_definitional` (`staff`). `grant_build_draft {form_id:'hamilton_loi_2025'}` reported
 * `by_actor.llm = 1` with `your_tasks: []`, and `jevs_c2l_2024` hid a definitional figure conflict
 * from the people meant to resolve it. Work package #250.
 *
 * One exhaustive map rather than two, split by {@link STATUS_ACTOR} at read time rather than by hand,
 * so the compiler catches a new status with no next step and the split cannot disagree with the
 * pipeline's own routing.
 */
const NEXT_STEP: Readonly<Record<AnswerStatus, string | null>> = {
  fits: null,
  ready: null,
  needs_resize: 'Shorten the handback source text to the limit, then re-measure.',
  needs_expand:
    'Write the full answer around the handback’s `anchor_value`, which must survive verbatim, drawing only on the source material — up to the limit and no further than that material supports.',
  compression_infeasible:
    'Shorten from the handback and state which facts you dropped — or check whether the field wants a short structured value instead of a narrative.',
  derive_from_reference:
    'Derive the short value from the handback source material. If it is not in there, flag it for staff rather than inventing it.',
  needs_live_figures:
    'Fill every `{{slot}}` in `figure_template` from the call named for it in `figure_slots`, changing nothing else. Check each slot’s `population` against what the question actually asked: if they differ, the stored sentence does not answer this question — say so rather than filling it with a differently-cut number. Leave any slot you cannot fill in place and name it.',
  needs_application_figures:
    'Supply the value(s) in `figure_slots` that belong to this application — an amount, a period. No connector holds them, and the figure from a previously filed application is not a substitute.',
  fetch_figure:
    'Run the `query_*` call named in `figure_call` and write the number it returns. A frozen knowledge-base figure is not an acceptable answer.',
  figure_definitional:
    'Run the `query_*` call named in `figure_call`, then have staff confirm which population the funder means before the number is written.',
  needs_attachment: 'Gather and upload the documents in the checklist.',
  per_application: 'Supply the application-specific value.',
  needs_review: 'Confirm the question mapping, or add the wording to the bank as a variant.',
  kb_gap: 'Write the missing knowledge-base entry.',
  kb_placeholder: 'Replace the placeholder with real content.',
};

interface OutstandingItem {
  readonly status: AnswerStatus;
  readonly count: number;
  /** Positions in `results`, 1-based, so a caller can jump straight to the work. */
  readonly questions: number[];
  readonly next_step: string;
}

/**
 * The outstanding work for one actor.
 *
 * `your_tasks` is work for the model that called this tool — it has the source text and the rules in
 * each result's `handback`, or the call to run in `figure_call`, so it can do them now.
 * `staff_actions` needs a fact or a decision this layer does not hold. Keeping the two apart is the
 * point: a model that treats a resize as a staff escalation stalls a draft that was ready to finish.
 */
function outstanding(pkg: DraftPackage, actor: Actor): OutstandingItem[] {
  const statuses = Object.keys(NEXT_STEP) as AnswerStatus[];
  return statuses
    .filter((status) => STATUS_ACTOR[status] === actor)
    .map((status) => ({
      status,
      count: pkg.summary.by_status[status] ?? 0,
      questions: pkg.results.map((r, i) => (r.status === status ? i + 1 : 0)).filter((n) => n > 0),
      next_step: NEXT_STEP[status] ?? '',
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function registerGrantBuildDraft(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const formId = parseStr(raw, 'form_id');
      const hasQuestions = Array.isArray(raw['questions']) && raw['questions'].length > 0;

      if (formId !== undefined && hasQuestions) {
        return toolError(
          'no_records',
          'Pass either `form_id` (a stored fixture) or `questions` (a captured form), not both.',
        );
      }

      let form;
      if (formId !== undefined) {
        if (!listFormIds().includes(formId)) {
          return toolError(
            'entity_not_found',
            `No stored form fixture named '${formId}'. Available: ${listFormIds().join(', ')}.`,
          );
        }
        form = loadForm(formId);
      } else {
        if (!hasQuestions) {
          return toolError(
            'no_records',
            'Pass `questions` (the captured form) with `funder`, or `form_id` to run a stored fixture.',
          );
        }
        const funder = parseStr(raw, 'funder');
        if (funder === undefined || funder.trim() === '') {
          return toolError(
            'no_records',
            'Pass `funder` alongside `questions` — a draft package is scoped to one funder.',
          );
        }
        // Validated through the same schema as a seed fixture, so an inline form and a stored one
        // cannot diverge in what the pipeline accepts.
        const parsed = incomingFormSchema.safeParse({
          meta: {
            funder,
            ...(parseStr(raw, 'program') !== undefined ? { program: parseStr(raw, 'program') } : {}),
            ...(parseStr(raw, 'due') !== undefined ? { due: parseStr(raw, 'due') } : {}),
            ...(parseStr(raw, 'framing') !== undefined ? { framing: parseStr(raw, 'framing') } : {}),
          },
          questions: raw['questions'],
        });
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; ');
          return toolError('no_records', `The form did not validate — ${issues}.`);
        }
        form = parsed.data;
      }

      // Principle 3, enforced at the one chokepoint every draft passes through: this tool is the
      // only caller of `runPipeline`. `program` and `framing` used to be optional fields nobody
      // checked — cosmetic Markdown and an LLM tone nudge respectively — so a draft could go out
      // built on an assumed program or fiscal-sponsorship posture. Ask, per `docs/PLAYBOOK.md` step
      // 2 and step 3, rather than assume.
      const missing = [
        form.meta.program === undefined ? 'program' : null,
        form.meta.framing === undefined ? 'framing' : null,
      ].filter((f): f is string => f !== null);
      if (missing.length > 0) {
        return toolError(
          'needs_input',
          `Which ${missing.join(' and ')} applies to this application? Both are required before ` +
            `drafting — never assume.`,
          [
            'program: which program or entity — "101", "LiftOff", or "Inc."?',
            'framing: which fiscal-sponsorship framing — `initiative` (Launchpad as an initiative ' +
              'of Building 21), `fiscal_sponsorship` (the formal fiscally sponsored structure), or ' +
              '`silent` (no detail on the Building 21 relationship)?',
          ].filter((s) => missing.some((f) => s.startsWith(`${f}:`))),
        );
      }

      const threshold = parseNum(raw, 'threshold') ?? DEFAULT_THRESHOLD;
      const pkg = runPipeline(form, loadBank(), loadKnowledgeBase(), threshold);
      const includeMarkdown = raw['include_markdown'] !== false;

      return {
        ...pkg,
        threshold,
        // Split by who acts. `your_tasks` is yours to finish now, from each result's `handback`.
        your_tasks: outstanding(pkg, 'llm'),
        staff_actions: outstanding(pkg, 'staff'),
        ...(includeMarkdown ? { markdown: renderMarkdown(pkg) } : {}),
        note:
          'DRAFT FOR STAFF REVIEW — not submittable. The stored answers exist so you do not rewrite ' +
          'what LaunchPad has already approved; where one does not drop straight into a field, the ' +
          'result carries a `handback` with the source text, the limit, the measurement, and the ' +
          'rules, and finishing it is yours. Then: run every call in figure_work_order and replace ' +
          'each stored figure with the live one (on a definitional conflict, escalate with both ' +
          'numbers rather than picking one); leave every staff_actions entry to a person; and edit ' +
          'for this funder’s voice. Never invent, infer, or round a figure the work order does not ' +
          'confirm, and never submit.',
      };
    }),
  );
}
