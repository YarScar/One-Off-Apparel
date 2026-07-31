/**
 * schemas.ts — zod schemas for the grant-writing seed data.
 *
 * Scope is grant WRITING only: the question bank, the knowledge base, and incoming funder forms.
 * Funder eligibility and fit scoring are another team's scope and have no schema here.
 *
 * Deliberately narrow: these validate the fields the tools actually read. Objects the seed may grow
 * are `.passthrough()`, so adding a field to `questions.json` does not break the loader. Anything a
 * drafted answer depends on IS validated, because silent shape drift there produces a confidently
 * wrong grant answer.
 */

import { z } from 'zod';

// --------------------------------------------------------------------------- primitives

export const ANSWER_TYPES = [
  'field',
  'number',
  'boolean',
  'single_select',
  'multi_select',
  'demographic',
  'narrative',
  'attachment',
] as const;
export const answerTypeSchema = z.enum(ANSWER_TYPES);
export type AnswerType = z.infer<typeof answerTypeSchema>;

/**
 * Answer types that want a short structured value or an uploaded document, not a narrative
 * paragraph.
 *
 * This matters because several questions of these types point at narrative KB slots: all 8
 * `attachment` questions route to `kb.docs`, and the 5 `eligibility.*` single-selects all route to
 * the 124-word `kb.eligibility`. Handing that prose back as the answer to "Are you a 501(c)(3)?
 * Yes/No" would be wrong, so the tools label it reference material rather than an answer.
 */
export const NON_NARRATIVE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set([
  'field',
  'number',
  'boolean',
  'single_select',
  'multi_select',
  'demographic',
  'attachment',
]);

export const FREQUENCIES = ['low', 'medium', 'high', 'very_high'] as const;
export const frequencySchema = z.enum(FREQUENCIES);
export type Frequency = z.infer<typeof frequencySchema>;

/**
 * Limit units. `chars` is an accepted alias for `characters`; `sentences` appears in
 * `questions.json` limits. The seed's incoming forms only use `words` and `characters`, but a real
 * funder form saying "3 sentences" must not be rejected.
 */
export const UNITS = ['words', 'characters', 'chars', 'sentences'] as const;
export const unitSchema = z.enum(UNITS);
export type Unit = z.infer<typeof unitSchema>;

// --------------------------------------------------------------------------- questions.json

export const bankLimitSchema = z.object({
  unit: unitSchema,
  max: z.number().int().positive(),
  /** Which funder's form this limit was observed on. */
  source: z.string(),
});

export const variantSchema = z.object({
  /** A real funder's wording for this question, verbatim. */
  text: z.string().min(1),
  source: z.string(),
});

export const questionSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    /** Funder-neutral phrasing: no funder name, no specific limit. */
    canonical: z.string().min(1),
    answer_type: answerTypeSchema,
    /** `null` means the value is application-specific (an amount, a signature) — not a KB slot. */
    kb_ref: z.string().nullable(),
    frequency: frequencySchema,
    /** Every limit ever observed for this question, across funders. Informational. */
    limits: z.array(bankLimitSchema).optional(),
    notes: z.string().optional(),
    variants: z.array(variantSchema).default([]),
  })
  .passthrough();

export const questionBankSchema = z
  .object({
    meta: z
      .object({
        name: z.string(),
        version: z.string(),
        updated: z.string(),
        sources: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
      })
      .passthrough(),
    categories: z.array(
      z.object({ id: z.string(), label: z.string(), description: z.string() }).passthrough(),
    ),
    kb_entries: z.array(z.object({ id: z.string(), label: z.string() }).passthrough()),
    questions: z.array(questionSchema).min(1),
  })
  .passthrough();

export type QuestionBank = z.infer<typeof questionBankSchema>;
export type Question = z.infer<typeof questionSchema>;
export type BankLimit = z.infer<typeof bankLimitSchema>;
export type Variant = z.infer<typeof variantSchema>;
export type Category = QuestionBank['categories'][number];
export type KbEntry = QuestionBank['kb_entries'][number];

// --------------------------------------------------------------------------- kb_launchpad.json

export const kbAnswerSchema = z
  .object({
    label: z.string(),
    /**
     * `true` means "grounded in filed application material". It does NOT authorize submission, and
     * it does NOT mean the figures inside are current — see `figures.ts`.
     */
    verified: z.boolean(),
    /** The longest canonical version; callers compress it to a funder's stated limit. */
    text: z.string(),
  })
  .passthrough();

export const knowledgeBaseSchema = z
  .object({
    meta: z
      .object({
        org: z.string(),
        updated: z.string(),
        note: z.string(),
        /** Precedence order for conflict resolution, newest first. */
        source_recency: z.string(),
        /** Prose record of the last read-only cross-check against the live connector. */
        connector_reconciliation: z.string(),
        framing: z.string().optional(),
      })
      .passthrough(),
    answers: z.record(z.string(), kbAnswerSchema),
  })
  .passthrough();

export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;
export type KbAnswer = z.infer<typeof kbAnswerSchema>;

// --------------------------------------------------------------------------- incoming forms

/**
 * A funder's form. Note the SINGULAR `limit` object here versus the PLURAL `limits` array in
 * `questions.json` — the bank records every limit ever observed for a canonical question, while a
 * form states the one limit that applies. Different types on purpose.
 *
 * Form questions carry no id; they are positional.
 */
export const formQuestionSchema = z
  .object({
    text: z.string().min(1),
    limit: z
      .object({
        unit: unitSchema,
        max: z.number().int().positive(),
      })
      .optional(),
  })
  .passthrough();

export const incomingFormSchema = z
  .object({
    meta: z
      .object({
        funder: z.string().min(1),
        program: z.string().optional(),
        note: z.string().optional(),
        /** The funder "hat" — what to emphasise when drafting. */
        framing: z.string().optional(),
        due: z.string().optional(),
      })
      .passthrough(),
    questions: z.array(formQuestionSchema).min(1).max(200),
  })
  .passthrough();

export type IncomingForm = z.infer<typeof incomingFormSchema>;
export type FormQuestion = z.infer<typeof formQuestionSchema>;
export type FormLimit = NonNullable<FormQuestion['limit']>;
