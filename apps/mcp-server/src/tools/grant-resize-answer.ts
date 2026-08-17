import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resizeAnswer, type ResizeContextInput } from '@lp-ai/lib-grants';

import { runTool, parseNum, parseStr } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'grant_resize_answer';

const DESCRIPTION =
  'Fit one stored answer to one funder’s stated length limit. Call it twice: first with `text` and ' +
  '`limit` to get the measurement and the rewrite rules, then again with your `rewrite` to have it ' +
  'checked. YOU do the rewriting — this tool measures, it does not generate. Deterministic: no model, ' +
  'no database, no network. The second call checks two things, and both must pass before you use a ' +
  'rewrite: that it fits the limit (arithmetic, because a model cannot reliably count its own words), ' +
  'and that every figure in it appears in the source. A rewrite stating a figure the source does not ' +
  'is REJECTED however well it fits — see `accepted`, not `fits_after_resize`. Nothing it returns is ' +
  'submittable; a person reviews and submits.';

const limitSchema = z.object({
  unit: z.enum(['words', 'characters', 'chars', 'sentences']),
  max: z.number().int().positive(),
});

const inputSchema = {
  text: z
    .string()
    .min(1)
    .describe(
      'The SOURCE answer, as stored. On the second call this stays the original — do not replace it ' +
        'with your rewrite, or the figure check has nothing to compare against.',
    ),
  limit: limitSchema.describe('The funder’s stated limit for this field.'),
  rewrite: z
    .string()
    .min(1)
    .optional()
    .describe('Your rewritten answer, to be measured and figure-checked. Omit on the first call.'),
  attempt: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Which pass this is, for the trace. Defaults to 1 without a rewrite, 2 with one.'),
  funder: z.string().optional().describe('The funder’s name, so the rewrite keeps the right register.'),
  framing: z
    .string()
    .optional()
    .describe('What to emphasise for this funder — preserved if already present, never added.'),
  kb_ref: z
    .string()
    .optional()
    .describe(
      'The knowledge-base slot the source came from, e.g. `kb.mission`. Supply it and the tool reads ' +
        'that slot’s own grounding flag and label rather than taking your word for either.',
    ),
  answers: z
    .string()
    .optional()
    .describe('What the source text answers, if no `kb_ref` applies.'),
};

export function registerGrantResizeAnswer(server: McpServer): void {
  server.registerTool(
    NAME,
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(NAME, input, async () => {
        const raw = input as Record<string, unknown>;

        // `limit` and `text` are required by the schema above, so the SDK rejects a missing one before
        // this runs — no re-validation here, which would be unreachable. What the schema cannot express
        // is that `min(1)` accepts a whitespace-only string, and measuring that reports "0 words fits"
        // for a field the caller has not actually filled.
        const text = parseStr(raw, 'text');
        if (text === undefined || text.trim() === '') {
          return toolError(
            'no_records',
            'Pass `text` — the source answer to fit to the limit. Whitespace is not an answer.',
          );
        }
        const limit = limitSchema.parse(raw['limit']);

        // Same trap as `text` above, on the other input: `.min(1)` accepts a single space, and a blank
        // rewrite measures 0 units, fits every limit, and invents no figure — so it was accepted as a
        // faithful resize. Rejected at the boundary as a caller error rather than passed through as a
        // verdict. `resizeAnswer` guards it too, being a public export. Work package #251.
        const rewriteRaw = parseStr(raw, 'rewrite');
        if (rewriteRaw !== undefined && rewriteRaw.trim() === '') {
          return toolError(
            'no_records',
            'Pass `rewrite` as your rewritten answer, or omit it to get the handback. Whitespace is ' +
              'not a rewrite — it measures as fitting every limit while answering nothing.',
          );
        }
        const rewrite = rewriteRaw;
        const context: ResizeContextInput = {
          funder: parseStr(raw, 'funder'),
          emphasis: parseStr(raw, 'framing'),
          kbRef: parseStr(raw, 'kb_ref'),
          answers: parseStr(raw, 'answers'),
        };

        const result = resizeAnswer({
          text,
          limit,
          ...(rewrite === undefined ? {} : { rewrite }),
          ...(parseNum(raw, 'attempt') === undefined ? {} : { attempt: parseNum(raw, 'attempt') }),
          context,
        });

        return {
          ...result,
          note:
            result.accepted
              ? 'DRAFT — the length is confirmed by arithmetic and every figure traces to the source. ' +
                'That is not the same as correct: the stored figures are a frozen snapshot, so verify ' +
                'each one against live data via grant_build_draft’s figure work order before ' +
                'publishing. A person reviews and submits.'
              : 'NOT USABLE YET. Do the work in `handback`, then call this tool again with your ' +
                'rewrite. Never invent, alter, or round a figure to make text fit — drop the ' +
                'least-essential detail instead, and if the field wants a short structured value ' +
                'rather than a narrative, say so rather than compressing prose into it.',
        };
      }),
  );
}
