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

interface ExtractedMeta {
  title: string;
  meeting_date: string | null;
  visibility: string | null;
  attendees: string[];
  attendee_emails: string[];
  visible_to_emails: string[];
  owner: string | null;
  project: string[];
  tags: string[];
  meeting_type: string | null;
  recording_url: string | null;
}

function richTextToPlain(rt: unknown): string {
  if (!Array.isArray(rt)) return '';
  return rt.map((r: unknown) => {
    const item = r as { plain_text?: string };
    return item.plain_text ?? '';
  }).join('');
}

function extractTitle(props: Record<string, NotionProperty>): string {
  for (const p of Object.values(props)) {
    if (p.type === 'title') {
      return richTextToPlain((p as { title?: unknown }).title).trim();
    }
  }
  return '';
}

function extractMultiSelect(prop: NotionProperty | undefined): string[] {
  if (!prop || prop.type !== 'multi_select') return [];
  const arr = (prop as { multi_select?: Array<{ name?: string }> }).multi_select;
  return (arr ?? []).map((s) => s.name ?? '').filter(Boolean);
}

function extractSelect(prop: NotionProperty | undefined): string | null {
  if (!prop || prop.type !== 'select') return null;
  return (prop as { select?: { name?: string } }).select?.name ?? null;
}

function extractDate(prop: NotionProperty | undefined): string | null {
  if (!prop || prop.type !== 'date') return null;
  return (prop as { date?: { start?: string } }).date?.start ?? null;
}

function extractUrl(prop: NotionProperty | undefined): string | null {
  if (!prop || prop.type !== 'url') return null;
  return (prop as { url?: string }).url ?? null;
}

function extractPeopleOrMultiSelect(prop: NotionProperty | undefined): string[] {
  if (!prop) return [];
  if (prop.type === 'people') {
    const arr = (prop as { people?: Array<{ name?: string }> }).people;
    return (arr ?? []).map((p) => p.name ?? '').filter(Boolean);
  }
  if (prop.type === 'multi_select') {
    return extractMultiSelect(prop);
  }
  return [];
}

function extractSinglePerson(prop: NotionProperty | undefined): string | null {
  if (!prop) return null;
  if (prop.type === 'people') {
    const arr = (prop as { people?: Array<{ name?: string }> }).people;
    return arr?.[0]?.name ?? null;
  }
  return extractSelect(prop);
}

function extractRelationOrMultiSelect(prop: NotionProperty | undefined): string[] {
  if (!prop) return [];
  if (prop.type === 'multi_select') return extractMultiSelect(prop);
  if (prop.type === 'relation') {
    const arr = (prop as { relation?: Array<{ id?: string }> }).relation;
    return (arr ?? []).map((r) => r.id ?? '').filter(Boolean);
  }
  return [];
}

// Resolve relation properties (e.g. Attendees/Owner linked to the People & Entities DB)
// into human-readable names. Cached per run so a person referenced across many meetings
// is only fetched once.
const personNameCache = new Map<string, string>();
const personEmailCache = new Map<string, string | null>();

async function resolvePersonName(pageId: string): Promise<string> {
  const cached = personNameCache.get(pageId);
  if (cached !== undefined) return cached;
  try {
    const related = await getPage<NotionPage>(pageId);
    const name = extractTitle(related.properties) || pageId;
    personNameCache.set(pageId, name);
    // Also cache email while we have the page
    const email = extractEmail(related.properties);
    personEmailCache.set(pageId, email);
    return name;
  } catch {
    personNameCache.set(pageId, pageId);
    personEmailCache.set(pageId, null);
    return pageId;
  }
}

function extractEmail(props: Record<string, NotionProperty>): string | null {
  const p = props['Email'];
  if (!p || p.type !== 'email') return null;
  return (p as { email?: string | null }).email ?? null;
}

async function resolvePersonEmail(pageId: string): Promise<string | null> {
  const cached = personEmailCache.get(pageId);
  if (cached !== undefined) return cached;
  // resolvePersonName also populates the email cache as a side effect
  await resolvePersonName(pageId);
  return personEmailCache.get(pageId) ?? null;
}

function extractRelationIds(prop: NotionProperty | undefined): string[] {
  if (!prop || prop.type !== 'relation') return [];
  const arr = (prop as { relation?: Array<{ id?: string }> }).relation;
  return (arr ?? []).map((r) => r.id ?? '').filter(Boolean);
}

// Attendees may be a People relation (current Notion DBs), a Notion `people` property,
// or a `multi_select` of names (legacy). Handle all three.
async function resolveAttendees(prop: NotionProperty | undefined): Promise<string[]> {
  if (!prop) return [];
  if (prop.type === 'relation') {
    return Promise.all(extractRelationIds(prop).map(resolvePersonName));
  }
  return extractPeopleOrMultiSelect(prop);
}

async function resolveOwner(prop: NotionProperty | undefined): Promise<string | null> {
  if (!prop) return null;
  if (prop.type === 'relation') {
    const ids = extractRelationIds(prop);
    return ids.length > 0 ? resolvePersonName(ids[0]!) : null;
  }
  return extractSinglePerson(prop);
}

function extractRichText(prop: NotionProperty | undefined): string {
  if (!prop || prop.type !== 'rich_text') return '';
  return richTextToPlain((prop as { rich_text?: unknown }).rich_text).trim();
}

export async function extractMeta(page: NotionPage): Promise<ExtractedMeta> {
  const props = page.properties;

  // Resolve Visible To relation → emails from People DB
  const visibleToIds = extractRelationIds(props['Visible To']);
  const visibleToEmails: string[] = [];
  for (const id of visibleToIds) {
    const email = await resolvePersonEmail(id);
    if (email) visibleToEmails.push(email.toLowerCase());
  }

  // Extract raw attendee emails (set by the meeting router)
  const rawAttendeeEmails = extractRichText(props['Attendee Emails']);
  const attendeeEmails = rawAttendeeEmails
    ? rawAttendeeEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    title: extractTitle(props),
    meeting_date: extractDate(props['Date']),
    visibility: extractSelect(props['Visibility']),
    attendees: await resolveAttendees(props['Attendees']),
    attendee_emails: attendeeEmails,
    visible_to_emails: visibleToEmails,
    owner: await resolveOwner(props['Owner']),
    project: extractRelationOrMultiSelect(props['Project']),
    tags: extractMultiSelect(props['Tags']),
    meeting_type: extractSelect(props['Type']),
    recording_url: extractUrl(props['URL']),
  };
}

interface SyncStats {
  pages_discovered: number;
  pages_skipped_no_visibility: number;
  pages_skipped_archived: number;
  pages_skipped_error: number;
  pages_synced: number;
  chunks_written: number;
}

export async function syncMeetings(opts?: { incrementalSince?: Date }): Promise<SyncStats> {
  const raw = process.env['NOTION_MEETING_TRANSCRIPTS_DB_ID'];
  if (!raw) {
    throw new Error('NOTION_MEETING_TRANSCRIPTS_DB_ID not set');
  }
  // Supports one or more meeting databases (comma-separated) — e.g. the Programs and
  // Inc. Clients Meetings DBs. Each is queried and chunked into document_chunks the same way.
  const databaseIds = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (databaseIds.length === 0) {
    throw new Error('NOTION_MEETING_TRANSCRIPTS_DB_ID is set but contains no database ids');
  }

  const stats: SyncStats = {
    pages_discovered: 0,
    pages_skipped_no_visibility: 0,
    pages_skipped_archived: 0,
    pages_skipped_error: 0,
    pages_synced: 0,
    chunks_written: 0,
  };

  const filter = opts?.incrementalSince
    ? {
        timestamp: 'last_edited_time',
        last_edited_time: { on_or_after: opts.incrementalSince.toISOString() },
      }
    : undefined;

  for (const databaseId of databaseIds) {
    for await (const page of queryDatabase<NotionPage>(databaseId, filter)) {
      stats.pages_discovered += 1;

      if (page.archived) {
        stats.pages_skipped_archived += 1;
        continue;
      }

      const meta = await extractMeta(page);
      if (!meta.visibility) {
        stats.pages_skipped_no_visibility += 1;
        console.warn(`  skipping page ${page.id} ("${meta.title || '<untitled>'}"): no Visibility tag`);
        continue;
      }

      try {
        const written = await syncOnePage(databaseId, page, meta);
        stats.chunks_written += written;
        stats.pages_synced += 1;
      } catch (err) {
        stats.pages_skipped_error += 1;
        console.error(`  failed page ${page.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return stats;
}

async function syncOnePage(
  databaseId: string,
  page: NotionPage,
  meta: ExtractedMeta,
): Promise<number> {
  const bodyText = await walkPageBlocks(page.id);
  if (!bodyText.trim()) return 0;

  const headerLines = [
    meta.title ? `# ${meta.title}` : null,
    meta.meeting_date ? `Date: ${meta.meeting_date}` : null,
    meta.meeting_type ? `Type: ${meta.meeting_type}` : null,
    meta.attendees.length ? `Attendees: ${meta.attendees.join(', ')}` : null,
    meta.owner ? `Owner: ${meta.owner}` : null,
  ].filter((l): l is string => !!l);
  const fullText = [...headerLines, '', bodyText].join('\n');

  const chunks = chunkText(fullText);
  if (chunks.length === 0) return 0;

  const embeddings = await embedBatch(chunks);

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
    // Compute allowed_emails for access control:
    // - Internal → null (all authenticated users)
    // - Attendees Only → attendee emails only (+ visible_to)
    // - Any level + Visible To set → those people are always included
    const allowedEmails: string[] | null =
      meta.visibility === 'Internal' && meta.visible_to_emails.length === 0
        ? null
        : [...new Set([
            ...(meta.visibility === 'Attendees Only' ? meta.attendee_emails : []),
            ...meta.visible_to_emails,
          ])];

    const metadata = {
      subtype: 'meeting',
      notion_page_id: page.id,
      notion_database_id: databaseId,
      last_edited_time: page.last_edited_time,
      meeting_date: meta.meeting_date,
      meeting_type: meta.meeting_type,
      attendees: meta.attendees,
      owner: meta.owner,
      project: meta.project,
      tags: meta.tags,
      recording_url: meta.recording_url,
      visibility_level: meta.visibility,
      allowed_emails: allowedEmails,
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
        ${meta.title || null},
        ${content},
        ${embeddingLiteral}::vector(1536),
        ${metadataJson}::jsonb,
        NOW()
      )
    `;
  }

  return chunks.length;
}
