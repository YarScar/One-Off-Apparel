import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { verifyFigureAnswer, type FigureCall } from '@lp-ai/lib-grants';

import { runTool, parseStr } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'grant_verify_figure';

const DESCRIPTION =
  'Closed-loop check for a `fetch_figure` answer: does the number you drafted actually match what ' +
  'the named query_* call returned? Call `figure_call.tool` YOURSELF first, under your own name — this ' +
  'tool never re-runs it (doing that server-side would authorise the call as `grant_verify_figure` ' +
  'instead of as the query tool, bypassing your role\'s own ACL on it). Then pass the answer text, the ' +
  '`figure_call` you were given, and the raw result you got back. Mismatch returns `needs_input` — redo ' +
  'the number, do not argue with the verdict. Deterministic: no model, no database, no network.';

const inputSchema = {
  answer_text: z
    .string()
    .min(1)
    .describe('The drafted answer text carrying the figure to verify.'),
  figure_call: z
    .object({
      tool: z.string().min(1),
      args: z.record(z.union([z.string(), z.number(), z.boolean()])),
    })
    .describe('The exact `{ tool, args }` from the `fetch_figure` result this answer is sourcing.'),
  query_result: z
    .unknown()
    .describe('The raw result YOU got back from calling `figure_call.tool` with `figure_call.args`.'),
};

export function registerGrantVerifyFigure(server: McpServer): void {
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

        const answerText = parseStr(raw, 'answer_text');
        if (answerText === undefined || answerText.trim() === '') {
          return toolError(
            'no_records',
            'Pass `answer_text` — the drafted answer to verify. Whitespace is not an answer.',
          );
        }

        // The schema requires `figure_call` and `query_result`, so the SDK rejects a missing one
        // before this runs. `query_result` is deliberately `z.unknown()` — every query_* tool has its
        // own output shape, and this tool's job is to diff whatever came back, not to know all of them.
        const figureCall = raw['figure_call'] as FigureCall;
        const queryResult = raw['query_result'];

        const verdict = verifyFigureAnswer(answerText, figureCall, queryResult);

        if (!verdict.matched) {
          return toolError(
            'needs_input',
            `${verdict.unmatched.join(', ')} in this answer does not appear anywhere in ` +
              `${figureCall.tool}'s result. Re-run ${figureCall.tool} with ` +
              `${JSON.stringify(figureCall.args)}, read what it actually returned, and rewrite the ` +
              'figure — do not keep a guessed, rounded, or stale number.',
            [
              verdict.live_values.length > 0
                ? `Numeric values ${figureCall.tool} actually returned: ${verdict.live_values.join(', ')}`
                : `${figureCall.tool}'s result carried no numeric value at all — check you passed the ` +
                  'right query_result.',
            ],
          );
        }

        return {
          matched: true,
          drafted_figures: verdict.drafted_figures,
          note:
            verdict.drafted_figures.length === 0
              ? 'No literal figure found in `answer_text` — nothing to verify. If this answer was ' +
                'supposed to carry a live number, check it was actually written in before finalizing.'
              : 'Every figure in this answer traces to the live result. Safe to finalize this figure ' +
                'answer.',
        };
      }),
  );
}
