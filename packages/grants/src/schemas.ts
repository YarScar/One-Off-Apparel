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
 * How Launchpad names its relationship to Building 21 for a given funder — `docs/PLAYBOOK.md` step 3
 * calls this the fiscal-sponsorship framing decision and says to ask every time, never assume. A
 * fixed set of postures, not open text, because a KB structured value branches on it (see
 * {@link kbStructuredValueSchema}'s `by_framing`) and a free string cannot drive that branch.
 */
export const FRAMINGS = ['initiative', 'fiscal_sponsorship', 'silent'] as const;
export const framingSchema = z.enum(FRAMINGS);
export type Framing = z.infer<typeof framingSchema>;

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

/**
 * Answer types where a funder's generous box might be a request for **prose**, rather than just a
 * roomy input for a short value. The gate on `needs_expand` — see `limits.ts::underfillsProseField`.
 *
 * Deliberately not the complement of {@link NON_NARRATIVE_ANSWER_TYPES}: `demographic` appears in
 * both. A demographic question ("who do you serve, and how many?") can be answered by a value *or*
 * by a paragraph depending on how much room the funder gives it, which is the whole ambiguity that
 * produced board `grant-h32`.
 *
 * The exclusions are what matter, and a real false positive is why this set exists at all. Hamilton's
 * LOI asks "Project/ Program/ Campaign Name" in a **250-character** box. Measured on size alone,
 * `Launchpad` fills 3.6% of it and looks badly under-answered; it is in fact the complete and correct
 * answer. A `field` is a name however large the box, and a guard that told the model to write 250
 * characters of prose into a title would cause the exact padding the expansion rules exist to forbid.
 */
export const EXPANDABLE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set(['narrative', 'demographic']);

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

/**
 * A short structured value that IS the answer to one question, keyed by question id.
 *
 * Slots are shared — `kb.eligibility` answers eight questions, `kb.profile.identity` answers five —
 * so a single per-slot value cannot serve them. Keying by question id disambiguates. The branch in
 * `buildAnswer` returns this as the answer before the `derive_from_reference` branch runs.
 *
 * Per-value `verified` overrides the entry-level flag; absent, the entry-level flag is the default.
 * DECISIONS.md D1 records the rule.
 */
export const kbStructuredValueSchema = z.object({
  /** The short value to drop into the field. NOT a narrative. */
  value: z.string(),
  /** Grounded in filed material, for THIS value. Defaults to the entry-level `verified`. */
  verified: z.boolean().optional(),
  /**
   * Framing-keyed overrides of `value`, for the rare slot whose correct wording depends on the
   * fiscal-sponsorship posture (`cover.fiscal_sponsor` is the one that exists today). Falls back to
   * `value` for any framing not listed here. Optional: most structured values don't vary by framing.
   */
  by_framing: z.record(framingSchema, z.string()).optional(),
});
export type KbStructuredValue = z.infer<typeof kbStructuredValueSchema>;

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
    /** Short structured values, keyed by question id. Optional: only questions that need one. */
    structured: z.record(z.string(), kbStructuredValueSchema).optional(),
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
        /** The funder "hat" — what to emphasise when drafting, and which fiscal-sponsorship posture. */
        framing: framingSchema.optional(),
        due: z.string().optional(),
      })
      .passthrough(),
    questions: z.array(formQuestionSchema).min(1).max(200),
  })
  .passthrough();

export type IncomingForm = z.infer<typeof incomingFormSchema>;
export type FormQuestion = z.infer<typeof formQuestionSchema>;
export type FormLimit = NonNullable<FormQuestion['limit']>;

// --------------------------------------------------------------------------- figure_checks.json

/**
 * Added under #8 (WP #333): `FIGURE_CHECKS` moved from a hand-edited TS array literal in `figures.ts`
 * to schema-validated seed JSON, so a figure correction is a data diff instead of a code diff — the
 * same reasoning that put `questions.json`/`kb_launchpad.json` here rather than in source.
 *
 * Kept as an independent schema rather than re-exporting `figures.ts`'s `FigureCheck` interface: the
 * loader lives in `figures.ts` itself (see that file's header comment on why, and `seed-io.ts`'s on
 * the cycle this avoids), so this only needs to describe the JSON shape, not share a type identity
 * with it. The two are kept in sync by hand; a mismatch fails loudly at import time via
 * `figureChecksArraySchema.parse`, not silently.
 */
export const FIGURE_CONFLICT_KINDS = ['drift', 'definitional', 'content_gap', 'unknown'] as const;
export const figureConflictKindSchema = z.enum(FIGURE_CONFLICT_KINDS);

export const FIGURE_SEVERITIES = ['high', 'medium', 'low'] as const;
export const figureSeveritySchema = z.enum(FIGURE_SEVERITIES);

export const figureCheckSchema = z
  .object({
    key: z.string().min(1),
    /** The claim as it appears in the KB, so a reviewer can find it in the text. */
    claim: z.string().min(1),
    /** KB slots whose text carries this claim. */
    appears_in: z.array(z.string()),
    /** The MCP tool to call. */
    tool: z.string().min(1),
    /** The tool call's arguments, verbatim — not all string; e.g. `launchpad_only` is boolean. */
    args: z.record(z.union([z.string(), z.number(), z.boolean()])),
    /** The population {@link args} actually returns — see `figures.ts`'s `FigureCheck.population` doc. */
    population: z.string().min(1),
    conflict_kind: figureConflictKindSchema,
    severity: figureSeveritySchema,
    note: z.string(),
    /**
     * History/rationale that lived as an inline `//` comment beside the entry in the old TS array —
     * why a slot was added to `appears_in`, or what a past correction fixed. JSON has no comment
     * syntax, so this carries what a comment used to; unlike `note`, it is not guidance for the
     * drafting agent, and most entries have none.
     */
    _provenance: z.string().optional(),
  })
  .passthrough();

export const figureChecksArraySchema = z.array(figureCheckSchema).min(1);
export type SeedFigureCheck = z.infer<typeof figureCheckSchema>;

// --------------------------------------------------------------------------- testimonials.json

/**
 * Added for the "Testimonials spreadsheet" ingest (2026-08-24, see
 * `/home/mili/.claude/plans/there-is-new-content-lexical-wilkes.md`): the first quotes/testimonials
 * source in the pipeline, filling the "additional student stories" gap `docs/PLAYBOOK.md` lists under
 * "What's Missing (and What to Ask Us For)".
 *
 * `client` is Launchpad Inc.'s own naming for the businesses it does paid work for — distinct from
 * `employer`, which is a hiring partner.
 */
export const TESTIMONIAL_ROLES = ['student', 'employer', 'other', 'client'] as const;
export const testimonialRoleSchema = z.enum(TESTIMONIAL_ROLES);
export type TestimonialRole = z.infer<typeof testimonialRoleSchema>;

export const testimonialSchema = z
  .object({
    id: z.string().min(1),
    role: testimonialRoleSchema,
    cohort: z.string().nullable(),
    school: z.string().nullable(),
    company: z.string().nullable(),
    title: z.string().nullable(),
    source: z.string().nullable(),
    quote: z.string().min(1),
    /**
     * Who said it. `null` for a de-identified student row — the de-identification rule this schema
     * exists to make machine-enforced, not just documented: see `checkTestimonialDeidentification`
     * in `data.ts`.
     */
    attribution: z.string().nullable(),
    /** Whether a name is on file to restore if `attribution` is currently null. */
    consent_on_file: z.boolean(),
    /**
     * `true` when `quote` was edited from the source spreadsheet to remove a THIRD PARTY's name
     * (a student named inline by an employer, not the quote's own attributed speaker) with no
     * consent on file for that person. Optional: most rows are unedited.
     */
    redacted: z.boolean().optional(),
  })
  .passthrough();

export const testimonialsBankSchema = z
  .object({
    meta: z
      .object({
        source: z.string(),
        fetched: z.string(),
        row_count: z.number().int().nonnegative(),
      })
      .passthrough(),
    quotes: z.array(testimonialSchema),
  })
  .passthrough();

export type Testimonial = z.infer<typeof testimonialSchema>;
export type TestimonialsBank = z.infer<typeof testimonialsBankSchema>;
