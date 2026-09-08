/**
 * Ingest specific Google Docs (by ID) into `document_chunks` for semantic
 * search. Every configured doc is fetched with all tabs (see docs-client.ts),
 * chunked, embedded, and upserted using a delete-by-prefix + insert pattern —
 * the same safety shape the Notion connector uses.
 *
 * Kept out of the main Grants-catalog walk on purpose: this path is opt-in via
 * a list of IDs, and it writes to a different table with a different lifecycle
 * (embeddings) than `grant_documents`.
 */
import crypto from 'node:crypto';
import { prisma } from '@lp-ai/lib-db';
import { embedBatch } from '@lp-ai/lib-embedding';
import {
  makeDocsClient,
  makeOAuthDocsClient,
  getDocumentAllTabs,
  extractTextFromTabs,
  type DocsClient,
} from './docs-client.js';
import { chunkText } from './chunker.js';

interface DocConfig {
  id: string;
  name: string;
}

function parseDocList(): DocConfig[] {
  const raw = process.env['GOOGLE_DOC_IDS'];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.indexOf(':');
      if (colonIdx > 0) {
        return { id: entry.slice(0, colonIdx).trim(), name: entry.slice(colonIdx + 1).trim() };
      }
      return { id: entry, name: entry };
    });
}

function docsClientFromEnv(): DocsClient | null {
  const deployed =
    process.env['NODE_ENV'] === 'production' ||
    process.env['USE_AWS_SECRETS'] === 'true';

  const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'];
  const refreshToken = process.env['GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN'];
  if (!deployed && clientId && clientSecret && refreshToken) {
    return makeOAuthDocsClient({ clientId, clientSecret, refreshToken });
  }

  const key = process.env['GOOGLE_SERVICE_ACCOUNT_JSON'];
  if (!key) return null;
  return makeDocsClient(key);
}

export interface DocsSyncStats {
  docs_configured: number;
  docs_synced: number;
  docs_skipped_empty: number;
  docs_skipped_error: number;
  chunks_written: number;
}

export async function syncDocs(): Promise<DocsSyncStats> {
  const docs = parseDocList();
  const stats: DocsSyncStats = {
    docs_configured: docs.length,
    docs_synced: 0,
    docs_skipped_empty: 0,
    docs_skipped_error: 0,
    chunks_written: 0,
  };
  if (docs.length === 0) {
    console.log('google-drive-docs: GOOGLE_DOC_IDS not set, skipping');
    return stats;
  }

  const client = docsClientFromEnv();
  if (!client) {
    console.warn('google-drive-docs: no Google identity configured, skipping');
    return stats;
  }

  for (const cfg of docs) {
    console.log(`google-drive-docs: syncing "${cfg.name}" (${cfg.id})`);
    try {
      const written = await syncOneDoc(client, cfg);
      if (written === 0) {
        stats.docs_skipped_empty += 1;
      } else {
        stats.docs_synced += 1;
        stats.chunks_written += written;
      }
    } catch (err) {
      stats.docs_skipped_error += 1;
      console.error(
        `  failed doc ${cfg.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return stats;
}

async function syncOneDoc(client: DocsClient, cfg: DocConfig): Promise<number> {
  const doc = await getDocumentAllTabs(client, cfg.id);
  const docTitle = doc.title?.trim() || cfg.name;
  const tabTitles = collectTabTitles(doc.tabs ?? []);
  const revisionId = doc.revisionId ?? null;

  const body = extractTextFromTabs(doc);
  const header = [`# ${docTitle}`, `Source: Google Doc`].join('\n');
  const fullText = `${header}\n\n${body}`.trim();
  if (!fullText || fullText.length < 20) return 0;

  const chunks = chunkText(fullText);
  if (chunks.length === 0) return 0;

  const embeddings = await embedBatch(chunks);

  await prisma.$executeRaw`
    DELETE FROM document_chunks
    WHERE source = 'drive'
      AND source_id LIKE ${'drive:doc:' + cfg.id + ':%'}
  `;

  for (let i = 0; i < chunks.length; i += 1) {
    const id = crypto.randomUUID();
    const sourceId = `drive:doc:${cfg.id}:${i}`;
    const content = chunks[i]!;
    const embedding = embeddings[i]!;
    const embeddingLiteral = `[${embedding.join(',')}]`;
    const metadata = {
      subtype: 'doc',
      google_doc_id: cfg.id,
      doc_name: cfg.name,
      doc_title: docTitle,
      revision_id: revisionId,
      tab_titles: tabTitles,
      chunk_index: i,
      chunk_count: chunks.length,
    };
    const metadataJson = JSON.stringify(metadata);

    await prisma.$executeRaw`
      INSERT INTO document_chunks (id, source, source_id, title, content, embedding, metadata, synced_at)
      VALUES (
        ${id},
        'drive',
        ${sourceId},
        ${docTitle || null},
        ${content},
        ${embeddingLiteral}::vector(1536),
        ${metadataJson}::jsonb,
        NOW()
      )
    `;
  }

  return chunks.length;
}

interface TabLike {
  tabProperties?: { title?: string | null } | null;
  childTabs?: TabLike[] | null;
}

function collectTabTitles(tabs: TabLike[]): string[] {
  const out: string[] = [];
  const walk = (t: TabLike): void => {
    const title = t.tabProperties?.title?.trim();
    if (title) out.push(title);
    for (const c of t.childTabs ?? []) walk(c);
  };
  for (const t of tabs) walk(t);
  return out;
}
