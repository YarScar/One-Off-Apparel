import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveEntityWithAliases } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum, getCurrentCallerEmail } from '../tool-helpers.js';
import { toolError } from '../errors.js';
import { searchDocuments } from './search-documents.js';

const NAME = 'search_by_person';

const DESCRIPTION =
  "Search all conversations (Slack and Notion meeting transcripts) for content about or involving a specific person. Resolves the person's identity across sources before searching. Use this tool when you want to find everything that's been said about a particular student or staff member.";

const inputSchema = {
  person_name: z
    .string()
    .describe('Name, nickname, or handle of the student or staff member.'),
  query: z
    .string()
    .optional()
    .describe('Optional: narrow the search with a semantic query within results for this person.'),
  top_k: z.number().int().optional(),
};

const MIN_SIMILARITY = 0.7;

export function registerSearchByPerson(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const personName = parseStr(raw, 'person_name') ?? '';
      if (!personName.trim()) {
        return toolError('entity_not_found', 'person_name is required.');
      }
      const query = parseStr(raw, 'query');
      const topK = Math.min(parseNum(raw, 'top_k') ?? 10, 20);

      const result = await resolveEntityWithAliases(personName);
      if (!result) {
        return toolError(
          'entity_not_found',
          `Could not resolve '${personName}' to a known person.`,
        );
      }

      const { resolved, aliases } = result;
      const entityId = resolved.student?.id ?? resolved.staff?.id ?? null;
      if (!entityId) {
        return toolError('entity_not_found', 'Resolved entity has no id.');
      }

      const aliasStrings = aliases.map((a) => a.alias.toLowerCase());

      const effectiveQuery = query?.trim() ?? personName;
      const candidates = await searchDocuments({
        query: effectiveQuery,
        topK: topK * 5,
        minSimilarity: MIN_SIMILARITY,
        callerEmail: getCurrentCallerEmail(),
      });

      const filtered = candidates.filter((r) =>
        aliasStrings.some((a) => r.content.toLowerCase().includes(a)),
      );

      return {
        entity: {
          id: entityId,
          canonical_name:
            resolved.student?.canonicalName ?? resolved.staff?.canonicalName ?? null,
          entity_type: resolved.entityType,
        },
        entity_resolved: true,
        results: filtered.slice(0, topK).map((r) => ({
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
