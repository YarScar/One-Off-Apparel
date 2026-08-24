import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DEFAULT_THRESHOLD,
  loadBank,
  loadIntegrityReport,
  matchQuestion,
  type MatchResult,
} from '@lp-ai/lib-grants';

import { runTool, parseStr, parseNum, READ_ONLY_ANNOTATIONS } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'grant_match_question';

const DESCRIPTION =
  'Match a funder application question to a canonical entry in the LaunchPad grant question bank (87 questions, 11 categories, 247 recorded funder wordings). Returns the matched question id, its knowledge base slot, the answer type, a confidence score, and which phrasing won the match. Deterministic — no model, no database, no network. Use this to find out whether a funder question has a stored answer before drafting one from scratch. A result with is_confident=false means the question has no reliable match and needs a person: do not route it to the returned kb_ref.';

const inputSchema = {
  question: z
    .string()
    .optional()
    .describe('A single funder question, exactly as the form words it.'),
  questions: z
    .array(z.string())
    .max(200)
    .optional()
    .describe('Several funder questions to match in one call. Results come back in input order.'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      `Confidence floor for is_confident. Defaults to ${String(DEFAULT_THRESHOLD)}, the value the prototype used for LaunchPad's filed applications. Lower it only to inspect near misses.`,
    ),
};

/** Shape returned for one matched question, with the confidence flag spelled out for the caller. */
interface MatchPayload extends MatchResult {
  readonly needs_human_review: boolean;
}

function decorate(r: MatchResult): MatchPayload {
  return { ...r, needs_human_review: !r.is_confident };
}

export function registerGrantMatchQuestion(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: READ_ONLY_ANNOTATIONS }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const single = parseStr(raw, 'question');
      const many = Array.isArray(raw['questions'])
        ? raw['questions'].filter((q): q is string => typeof q === 'string')
        : undefined;

      const texts = [...(single !== undefined ? [single] : []), ...(many ?? [])];
      if (texts.length === 0) {
        return toolError(
          'no_records',
          'Pass either `question` (one string) or `questions` (an array of strings).',
        );
      }
      if (texts.every((t) => t.trim() === '')) {
        return toolError('no_records', 'Every question was blank — nothing to match.');
      }

      const threshold = parseNum(raw, 'threshold') ?? DEFAULT_THRESHOLD;
      const bank = loadBank();
      const results = texts.map((t) => decorate(matchQuestion(t, bank, threshold)));
      const lowConfidence = results.filter((r) => !r.is_confident).length;

      return {
        threshold,
        bank_version: bank.meta.version,
        bank_size: {
          questions: bank.questions.length,
          categories: bank.categories.length,
          kb_slots: bank.kb_entries.length,
        },
        matched_count: results.length - lowConfidence,
        needs_review_count: lowConfidence,
        results,
        // Cross-file seed problems, echoed so a caller never drafts against a corpus with a known
        // gap without seeing it. Empty on a clean seed.
        integrity_warnings: loadIntegrityReport(),
        note: 'A match points at a stored answer; it is not the answer. Retrieve the answer with grant_build_draft, then verify every figure in it against live data before drafting. Anything with needs_human_review=true has no reliable stored answer.',
      };
    }),
  );
}
