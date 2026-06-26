import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runTool, parseStr, parseNum, getCurrentCallerEmail } from '../tool-helpers.js';
import { toolError } from '../errors.js';
import { searchDocuments } from './search-documents.js';

const NAME = 'search_conversations';

const DESCRIPTION =
  'Search Slack messages and Notion meeting transcripts for content relevant to a query. Returns the most semantically similar passages. Use this tool when asked about team discussions, decisions, or anything said in Slack or meetings.';

const inputSchema = {
  query: z.string().describe('Natural language search query.'),
  sources: z
    .array(z.enum(['slack', 'notion']))
    .optional()
    .describe('Optional: limit to specific source(s). Searches both by default. Use "notion" for meeting transcripts.'),
  top_k: z
    .number()
    .int()
    .optional()
    .describe('Number of results to return. Default 8, max 20.'),
};

const MIN_SIMILARITY = 0.75;

export function registerSearchConversations(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const query = parseStr(raw, 'query') ?? '';
      if (!query.trim()) {
        return toolError('search_failed', 'query is required.');
      }
      const sourcesRaw = Array.isArray(raw['sources']) ? raw['sources'] : undefined;
      const sources = sourcesRaw?.filter(
        (s): s is string => typeof s === 'string',
      ) ?? ['slack', 'notion'];
      const topK = Math.min(parseNum(raw, 'top_k') ?? 8, 20);

      const rows = await searchDocuments({
        query,
        sources,
        topK,
        minSimilarity: MIN_SIMILARITY,
        callerEmail: getCurrentCallerEmail(),
      });

      return {
        query,
        results: rows.map((r) => ({
          source: r.source,
          source_id: r.source_id,
          title: r.title,
          content: r.content,
          metadata: r.metadata,
          score: r.similarity,
        })),
      };
    }),
  );
}
