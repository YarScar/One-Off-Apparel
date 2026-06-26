import crypto from 'node:crypto';
import { prisma } from '@lp-ai/lib-db';
import { embedBatch } from '@lp-ai/lib-embedding';
import { getPage, queryDatabase } from './notion-client.js';
import { walkPageBlocks } from './block-walker.js';
import { chunkText } from './chunker.js';

interface NotionProperty {
  id?: string;
  type: string;
  [key: string]: unknown;
}

interface NotionPage {
  id: string;
  last_edited_time: string;
  archived?: boolean;
  properties: Record<string, NotionProperty>;
}

// ── Property extractors ────────────────────────────────────────────────

function richTextToPlain(rt: unknown): string {
  if (!Array.isArray(rt)) return '';
  return rt.map((r: { plain_text?: string }) => r.plain_text ?? '').join('');
}

function extractTitle(props: Record<string, NotionProperty>): string {
  for (const p of Object.values(props)) {
    if (p.type === 'title') {
      return richTextToPlain((p as { title?: unknown }).title).trim();
    }
  }
  return '';
}

// Resolve a relation page id → its title. Cached per run.
const titleCache = new Map<string, string>();

async function resolveTitle(pageId: string): Promise<string> {
  const cached = titleCache.get(pageId);
  if (cached !== undefined) return cached;
  try {
    const related = await getPage<NotionPage>(pageId);
    const name = extractTitle(related.properties) || pageId;
    titleCache.set(pageId, name);
    return name;
  } catch {
    titleCache.set(pageId, pageId);
    return pageId;
  }
}

/** Extract a flat key→string map from all properties (for metadata + header). */
async function extractProperties(
  props: Record<string, NotionProperty>,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const [name, prop] of Object.entries(props)) {
    switch (prop.type) {
      case 'title':
        out[name] = richTextToPlain((prop as { title?: unknown }).title).trim() || null;
        break;
      case 'rich_text':
        out[name] = richTextToPlain((prop as { rich_text?: unknown }).rich_text).trim() || null;
        break;
      case 'select':
        out[name] = (prop as { select?: { name?: string } }).select?.name ?? null;
        break;
      case 'multi_select': {
        const arr = (prop as { multi_select?: Array<{ name?: string }> }).multi_select ?? [];
        const vals = arr.map((s) => s.name ?? '').filter(Boolean);
        out[name] = vals.length > 0 ? vals.join(', ') : null;
        break;
      }
      case 'date':
        out[name] = (prop as { date?: { start?: string } }).date?.start ?? null;
        break;
      case 'number': {
        const n = (prop as { number?: number | null }).number;
        out[name] = n != null ? String(n) : null;
        break;
      }
      case 'url':
        out[name] = (prop as { url?: string | null }).url ?? null;
        break;
      case 'email':
        out[name] = (prop as { email?: string | null }).email ?? null;
        break;
      case 'phone_number':
        out[name] = (prop as { phone_number?: string | null }).phone_number ?? null;
        break;
      case 'checkbox':
        out[name] = (prop as { checkbox?: boolean }).checkbox ? 'Yes' : 'No';
        break;
      case 'relation': {
        const ids = ((prop as { relation?: Array<{ id?: string }> }).relation ?? [])
          .map((r) => r.id ?? '')
          .filter(Boolean);
        if (ids.length > 0) {
          const names = await Promise.all(ids.map(resolveTitle));
          out[name] = names.join(', ');
        } else {
          out[name] = null;
        }
        break;
      }
      case 'status':
        out[name] = (prop as { status?: { name?: string } }).status?.name ?? null;
        break;
      default:
        // unique_id, created_time, last_edited_time, etc — skip
        break;
    }
  }
  return out;
}

// ── Database config ────────────────────────────────────────────────────

interface DbConfig {
  id: string;
  name: string;
}

function parseDatabaseList(): DbConfig[] {
  const raw = process.env['NOTION_SYNC_DATABASE_IDS'];
  if (!raw) return [];
  // Format: "id:Name, id:Name" or just "id, id" (name derived later)
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

// ── Sync logic ─────────────────────────────────────────────────────────

export interface DatabaseSyncStats {
  databases_processed: number;
  pages_discovered: number;
  pages_synced: number;
  pages_skipped_archived: number;
  pages_skipped_empty: number;
  pages_skipped_error: number;
  chunks_written: number;
}

export async function syncDatabases(): Promise<DatabaseSyncStats> {
  const databases = parseDatabaseList();
  if (databases.length === 0) {
    console.log('notion-databases: NOTION_SYNC_DATABASE_IDS not set, skipping');
    return {
      databases_processed: 0,
      pages_discovered: 0,
      pages_synced: 0,
      pages_skipped_archived: 0,
      pages_skipped_empty: 0,
      pages_skipped_error: 0,
      chunks_written: 0,
    };
  }

  const stats: DatabaseSyncStats = {
    databases_processed: 0,
    pages_discovered: 0,
    pages_synced: 0,
    pages_skipped_archived: 0,
    pages_skipped_empty: 0,
    pages_skipped_error: 0,
    chunks_written: 0,
  };

  for (const db of databases) {
    console.log(`notion-databases: syncing "${db.name}" (${db.id})`);
    stats.databases_processed += 1;

    for await (const page of queryDatabase<NotionPage>(db.id)) {
      stats.pages_discovered += 1;

      if (page.archived) {
        stats.pages_skipped_archived += 1;
        continue;
      }

      try {
        const written = await syncOnePage(db, page);
        if (written === 0) {
          stats.pages_skipped_empty += 1;
        } else {
          stats.chunks_written += written;
          stats.pages_synced += 1;
        }
      } catch (err) {
        stats.pages_skipped_error += 1;
        console.error(`  failed page ${page.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return stats;
}

async function syncOnePage(db: DbConfig, page: NotionPage): Promise<number> {
  const props = await extractProperties(page.properties);
  const title = props['Name'] ?? props['Term'] ?? Object.values(props).find((v) => v) ?? '';

  const bodyText = await walkPageBlocks(page.id);

  // Build header from properties for context
  const headerLines: string[] = [];
  if (title) headerLines.push(`# ${title}`);
  headerLines.push(`Database: ${db.name}`);
  for (const [key, val] of Object.entries(props)) {
    if (val && key !== 'Name' && key !== 'Term') {
      headerLines.push(`${key}: ${val}`);
    }
  }

  const fullText = [...headerLines, '', bodyText].join('\n').trim();
  if (!fullText || fullText.length < 20) return 0;

  const chunks = chunkText(fullText);
  if (chunks.length === 0) return 0;

  const embeddings = await embedBatch(chunks);

  // Delete existing chunks for this page
  await prisma.$executeRaw`
    DELETE FROM document_chunks
    WHERE source = 'notion'
      AND source_id LIKE ${'notion:' + page.id + ':%'}
  `;

  for (let i = 0; i < chunks.length; i += 1) {
    const id = crypto.randomUUID();
    const sourceId = `notion:${page.id}:${i}`;
    const content = chunks[i]!;
    const embedding = embeddings[i]!;
    const embeddingLiteral = `[${embedding.join(',')}]`;
    const metadata = {
      subtype: 'document',
      notion_page_id: page.id,
      notion_database_id: db.id,
      notion_database_name: db.name,
      last_edited_time: page.last_edited_time,
      properties: props,
      chunk_index: i,
      chunk_count: chunks.length,
    };
    const metadataJson = JSON.stringify(metadata);

    await prisma.$executeRaw`
      INSERT INTO document_chunks (id, source, source_id, title, content, embedding, metadata, synced_at)
      VALUES (
        ${id},
        'notion',
        ${sourceId},
        ${title || null},
        ${content},
        ${embeddingLiteral}::vector(1536),
        ${metadataJson}::jsonb,
        NOW()
      )
    `;
  }

  return chunks.length;
}
