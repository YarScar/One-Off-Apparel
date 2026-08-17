import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';

import { runTool, parseStr, parseNum } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'find_grant_documents';

const DESCRIPTION =
  'Find grant documents in the Google Drive "Grants" tree by funder, year, and document kind. ' +
  'Returns a catalog listing (no document text) including each match\'s Drive file ID, which you ' +
  'then pass to a Google Drive read tool to fetch the content you actually need. Use this whenever ' +
  'you need past applications, budgets, reports, or letters of support: Drive search cannot see ' +
  'inside this tree, so this catalog is the only way to discover what exists. ' +
  'By default results exclude archive-only material (older applications describing a program ' +
  'Launchpad no longer runs) and documents Launchpad did not author — pass include_archive or ' +
  'include_external to widen the search for research rather than drafting.';

/**
 * Kinds are a closed vocabulary derived from the Drive folder structure. Listing
 * them in the schema lets the model filter precisely instead of guessing at
 * free-text values that would silently match nothing.
 */
const DOC_KINDS = [
  'application_response',
  'budget',
  'agreement',
  'report',
  'letter_of_support',
  'loi',
  'meeting_notes',
  'template',
  'attachment',
  'program_description',
  'external_reference',
  'transcript',
  'other',
] as const;

const COLLECTIONS = [
  'prospects',
  'current_past',
  'program_descriptions',
  'org_reference',
  'internal_ai_os',
] as const;

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

const inputSchema = {
  funder: z
    .string()
    .optional()
    .describe(
      'Funder name, matched case-insensitively as a substring: "truist" matches "Truist Foundation".',
    ),
  year: z.number().int().optional().describe('Exact application year, e.g. 2026.'),
  year_min: z.number().int().optional().describe('Earliest application year, inclusive.'),
  year_max: z.number().int().optional().describe('Latest application year, inclusive.'),
  doc_kind: z
    .enum(DOC_KINDS)
    .optional()
    .describe('Restrict to one kind of document.'),
  collection: z.enum(COLLECTIONS).optional().describe('Restrict to one top-level collection.'),
  title_contains: z
    .string()
    .optional()
    .describe('Case-insensitive substring match on the filename.'),
  include_archive: z
    .boolean()
    .optional()
    .describe(
      'Include archive-only documents (applications predating the current program). ' +
        'Default false. These are research material — do not draft from them.',
    ),
  include_external: z
    .boolean()
    .optional()
    .describe(
      'Include documents Launchpad did not author, such as funder rules and other ' +
        "organizations' applications. Default false. Never quote these into a submission.",
    ),
  only_fetchable: z
    .boolean()
    .optional()
    .describe(
      'Only return rows that have a Drive file ID and extractable text, i.e. rows whose ' +
        'content can actually be fetched right now. Default false.',
    ),
  limit: z.number().int().optional().describe(`Max rows to return (default ${DEFAULT_LIMIT}).`),
};

interface FindParams {
  funder?: string;
  year?: number;
  yearMin?: number;
  yearMax?: number;
  docKind?: string;
  collection?: string;
  titleContains?: string;
  includeArchive?: boolean;
  includeExternal?: boolean;
  onlyFetchable?: boolean;
  limit?: number;
}

export async function findGrantDocuments(params: FindParams): Promise<{
  total_matching: number;
  returned: number;
  facets: { funders: Record<string, number>; kinds: Record<string, number> };
  results: unknown[];
}> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const yearFilter =
    params.year !== undefined
      ? { year: params.year }
      : params.yearMin !== undefined || params.yearMax !== undefined
        ? {
            year: {
              ...(params.yearMin !== undefined ? { gte: params.yearMin } : {}),
              ...(params.yearMax !== undefined ? { lte: params.yearMax } : {}),
            },
          }
        : {};

  const where = {
    // Do-not-ingest material is never returned, on any flag combination. It was
    // marked exclude by an explicit human instruction, not by inference.
    excluded: false,
    ...(params.includeArchive ? {} : { archiveOnly: false }),
    ...(params.includeExternal ? {} : { externalReference: false }),
    ...(params.funder ? { funder: { contains: params.funder, mode: 'insensitive' as const } } : {}),
    ...(params.docKind ? { docKind: params.docKind } : {}),
    ...(params.collection ? { collection: params.collection } : {}),
    ...(params.titleContains
      ? { filename: { contains: params.titleContains, mode: 'insensitive' as const } }
      : {}),
    ...(params.onlyFetchable ? { driveFileId: { not: null }, contentClass: 'text' } : {}),
    ...yearFilter,
  };

  const [total, rows, byFunder, byKind] = await Promise.all([
    prisma.grantDocument.count({ where }),
    prisma.grantDocument.findMany({
      where,
      // Newest application year first: for grant writing, recency is almost
      // always what the caller wants. Nulls sort last.
      orderBy: [{ year: { sort: 'desc', nulls: 'last' } }, { funder: 'asc' }, { filename: 'asc' }],
      take: limit,
    }),
    prisma.grantDocument.groupBy({ by: ['funder'], where, _count: true }),
    prisma.grantDocument.groupBy({ by: ['docKind'], where, _count: true }),
  ]);

  const toRecord = <T extends { _count: number }>(
    groups: T[],
    key: (g: T) => string | null,
  ): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const g of groups) {
      out[key(g) ?? 'unknown'] = g._count;
    }
    return out;
  };

  return {
    total_matching: total,
    returned: rows.length,
    // Facets let the caller narrow a broad hit list without a second round trip.
    facets: {
      funders: toRecord(byFunder, (g) => g.funder),
      kinds: toRecord(byKind, (g) => g.docKind),
    },
    results: rows.map((r) => ({
      // The handle for fetching content. Null means the Drive walk has not
      // reached this row yet, so it can be seen but not read.
      drive_file_id: r.driveFileId,
      drive_url: r.driveUrl,
      fetchable: r.driveFileId !== null && r.contentClass === 'text',
      path: r.path,
      filename: r.filename,
      funder: r.funder,
      year: r.year,
      doc_kind: r.docKind,
      collection: r.collection,
      mime_type: r.mimeType,
      archive_only: r.archiveOnly,
      external_reference: r.externalReference,
      // True when funder/year/kind were not confidently inferred from the path.
      needs_review: r.needsReview,
      size_bytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
      modified_at: r.modifiedAt,
    })),
  };
}

export function registerFindGrantDocuments(server: McpServer): void {
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

        const yearMin = parseNum(raw, 'year_min');
        const yearMax = parseNum(raw, 'year_max');
        if (yearMin !== undefined && yearMax !== undefined && yearMin > yearMax) {
          return toolError(
            'search_failed',
            `year_min (${String(yearMin)}) exceeds year_max (${String(yearMax)}).`,
          );
        }

        const bool = (key: string): boolean | undefined => {
          const v = raw[key];
          return typeof v === 'boolean' ? v : undefined;
        };

        const funder = parseStr(raw, 'funder');
        const docKind = parseStr(raw, 'doc_kind');
        const collection = parseStr(raw, 'collection');
        const titleContains = parseStr(raw, 'title_contains');
        const year = parseNum(raw, 'year');
        const limit = parseNum(raw, 'limit');
        const includeArchive = bool('include_archive');
        const includeExternal = bool('include_external');
        const onlyFetchable = bool('only_fetchable');

        const result = await findGrantDocuments({
          ...(funder ? { funder } : {}),
          ...(year !== undefined ? { year } : {}),
          ...(yearMin !== undefined ? { yearMin } : {}),
          ...(yearMax !== undefined ? { yearMax } : {}),
          ...(docKind ? { docKind } : {}),
          ...(collection ? { collection } : {}),
          ...(titleContains ? { titleContains } : {}),
          ...(includeArchive !== undefined ? { includeArchive } : {}),
          ...(includeExternal !== undefined ? { includeExternal } : {}),
          ...(onlyFetchable !== undefined ? { onlyFetchable } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });

        return {
          ...result,
          // Stated inline so a caller acting on these rows knows the next step
          // and the one real constraint, without needing the tool description.
          usage_note:
            'Pass drive_file_id to a Google Drive read tool to fetch content. Rows with ' +
            'fetchable=false have no Drive ID recorded yet. Never use archive_only or ' +
            'external_reference documents as drafting context.',
        };
      }),
  );
}
