import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import { embedText } from '@lp-ai/lib-embedding';

import { runTool, parseStr, parseNum, getCurrentCallerEmail } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'search_documents';

const DESCRIPTION =
  'Generic pgvector semantic search across all ingested document_chunks (Drive docs, Slack, Roam, and future sources). Use when a question may have its answer in any narrative content the org has ingested, with optional source filter and similarity threshold.';

const inputSchema = {
  query: z.string().describe('Natural language search query.'),
  source: z
    .string()
    .optional()
    .describe('Optional: restrict to a single source (e.g. "drive", "slack", "roam").'),
  top_k: z.number().int().optional(),
  min_similarity: z.number().optional(),
};

export interface SearchRow {
  id: string;
  source: string;
  source_id: string;
  title: string | null;
  content: string;
  metadata: unknown;
  similarity: number;
}

/**
 * Check whether the caller is allowed to see a given search result based on
 * the `allowed_emails` field in its metadata. Rules:
 *  - Non-meeting chunks (no allowed_emails key) → visible to all
 *  - Meeting chunks with allowed_emails: null (Internal) → visible to all
 *  - Meeting chunks with allowed_emails: [...] → visible only if callerEmail is in the list
 */
function isVisibleToCaller(row: SearchRow, callerEmail: string | null): boolean {
  const meta = row.metadata as Record<string, unknown> | null;
  if (!meta || !('allowed_emails' in meta)) return true;
  if (meta['allowed_emails'] === null) return true;
  if (!callerEmail) return false;
  const allowed = meta['allowed_emails'];
  if (!Array.isArray(allowed)) return true;
  return allowed.includes(callerEmail.toLowerCase());
}

export async function searchDocuments(params: {
  query: string;
  source?: string;
  sources?: string[];
  topK?: number;
  minSimilarity?: number;
  callerEmail?: string | null;
}): Promise<SearchRow[]> {
  const topK = Math.min(params.topK ?? 8, 20);
  const minSim = params.minSimilarity ?? 0.7;
  const embedding = await embedText(params.query);
  const embeddingLiteral = `[${embedding.join(',')}]`;

  // Fetch more rows than requested so we can filter by visibility and still
  // return up to topK results.
  const fetchLimit = topK * 3;

  let rows: SearchRow[];

  if (params.sources && params.sources.length > 0) {
    rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT id, source, source_id, title, content, metadata,
             1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
      FROM document_chunks
      WHERE embedding IS NOT NULL
        AND source = ANY(${params.sources}::text[])
        AND 1 - (embedding <=> ${embeddingLiteral}::vector) >= ${minSim}
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${fetchLimit}
    `;
  } else if (params.source) {
    rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT id, source, source_id, title, content, metadata,
             1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
      FROM document_chunks
      WHERE embedding IS NOT NULL
        AND source = ${params.source}
        AND 1 - (embedding <=> ${embeddingLiteral}::vector) >= ${minSim}
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${fetchLimit}
    `;
  } else {
    rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT id, source, source_id, title, content, metadata,
             1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
      FROM document_chunks
      WHERE embedding IS NOT NULL
        AND 1 - (embedding <=> ${embeddingLiteral}::vector) >= ${minSim}
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${fetchLimit}
    `;
  }

  const callerEmail = params.callerEmail ?? null;
  return rows.filter((r) => isVisibleToCaller(r, callerEmail)).slice(0, topK);
}

export function registerSearchDocuments(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const query = parseStr(raw, 'query') ?? '';
      if (!query.trim()) {
        return toolError('search_failed', 'query is required.');
      }
      const source = parseStr(raw, 'source');
      const topK = parseNum(raw, 'top_k');
      const minSimilarity = parseNum(raw, 'min_similarity');

      const rows = await searchDocuments({
        query,
        ...(source ? { source } : {}),
        ...(topK !== undefined ? { topK } : {}),
        ...(minSimilarity !== undefined ? { minSimilarity } : {}),
        callerEmail: getCurrentCallerEmail(),
      });
      return {
        query,
        result_count: rows.length,
        results: rows.map((r) => ({
          id: r.id,
          source: r.source,
          source_id: r.source_id,
          title: r.title,
          content: r.content,
          metadata: r.metadata,
          similarity: r.similarity,
        })),
      };
    }),
  );
}
