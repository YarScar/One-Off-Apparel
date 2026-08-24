import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadEnv } from '@lp-ai/lib-config';
import { prisma } from '@lp-ai/lib-db';
import { extractDocxText } from '@lp-ai/lib-grants';
import { clientFromEnv } from '@lp-ai/connector-google-drive';

import { runTool, parseStr } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'get_grant_document_text';

const DESCRIPTION =
  'Fetch the extracted text of a grant document found by `find_grant_documents`, given its ' +
  'drive_file_id. Only rows that tool reports as fetchable (a Drive ID and contentClass "text") ' +
  'can be read; call it first. Supports Google Docs/Slides and uploaded .docx/.dotx files today — ' +
  'other text-bearing types (PDF, .doc, spreadsheets, etc.) return not_yet_implemented. ' +
  'Production Drive auth for the Grants tree is unverified (the service account may not have ' +
  'access); a permission or not-found error here likely means that, not a missing file.';

const inputSchema = {
  drive_file_id: z.string().min(1).describe('drive_file_id from a find_grant_documents result.'),
};

const GOOGLE_NATIVE_TEXT = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
]);

const DOCX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
]);

export function registerGetGrantDocumentText(server: McpServer): void {
  server.registerTool(
    NAME,
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(NAME, input, async () => {
        const raw = input as Record<string, unknown>;
        const driveFileId = parseStr(raw, 'drive_file_id');
        if (driveFileId === undefined || driveFileId.trim() === '') {
          return toolError('no_records', 'Pass `drive_file_id` — whitespace is not an ID.');
        }

        const row = await prisma.grantDocument.findUnique({ where: { driveFileId } });
        if (!row) {
          return toolError(
            'entity_not_found',
            `No catalog row for drive_file_id ${driveFileId}. Call find_grant_documents first.`,
          );
        }
        if (row.driveFileId === null || row.contentClass !== 'text') {
          return toolError(
            'no_records',
            `${row.filename} is not fetchable (contentClass=${row.contentClass ?? 'null'}). ` +
              'find_grant_documents reports this on each row as `fetchable`.',
          );
        }

        const env = await loadEnv();
        const client = clientFromEnv(env);
        if (!client) {
          return toolError(
            'internal_error',
            'No Drive identity configured (GOOGLE_SERVICE_ACCOUNT_JSON, or the OAuth trio).',
          );
        }

        const mimeType = row.mimeType ?? '';
        try {
          if (GOOGLE_NATIVE_TEXT.has(mimeType)) {
            const text = await client.exportText(driveFileId, mimeType);
            if (text === null) {
              return toolError('internal_error', `Drive export returned no text for ${row.filename}.`);
            }
            return { drive_file_id: driveFileId, filename: row.filename, text };
          }

          if (DOCX_MIME_TYPES.has(mimeType)) {
            const bytes = await client.downloadFile(driveFileId);
            const text = await extractDocxText(bytes);
            return { drive_file_id: driveFileId, filename: row.filename, text };
          }

          return toolError(
            'not_yet_implemented',
            `${NAME} does not yet extract mime type ${mimeType || '(unknown)'} for ${row.filename} ` +
              '— only Google Docs/Slides and .docx/.dotx are ported today.',
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return toolError(
            'internal_error',
            `Drive read failed for ${row.filename}: ${message}. Production Drive auth for the ` +
              'Grants tree is documented as unverified — a 403/404 here is likely that.',
          );
        }
      }),
  );
}
