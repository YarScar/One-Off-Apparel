import crypto from 'node:crypto';
import { prisma } from '@lp-ai/lib-db';
import { embedBatch } from '@lp-ai/lib-embedding';
import { getPage, listBlockChildren } from './notion-client.js';
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

interface AnyBlock {
  id: string;
  type: string;
  has_children?: boolean;
  child_page?: { title?: string };
}

interface PageConfig {
  id: string;
  name: string;
}

interface DiscoveredPage {
  pageId: string;
  title: string;
  breadcrumbs: string[];
  depth: number;
}

const MAX_TREE_DEPTH = 4;
const MAX_BLOCK_RECURSION = 6;

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

function parsePageList(): PageConfig[] {
  const raw = process.env['NOTION_SYNC_PAGE_IDS'];
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

// Enumerate `child_page` blocks anywhere in a page's block tree (including
// nested inside toggles, columns, synced blocks). Does NOT descend into
// child_page blocks themselves — those become their own sync targets.
async function collectChildPagesInPage(
  pageId: string,
): Promise<Array<{ id: string; title: string }>> {
  const found: Array<{ id: string; title: string }> = [];
  await recurse(pageId, 0);
  return found;

  async function recurse(blockId: string, blockDepth: number): Promise<void> {
    if (blockDepth > MAX_BLOCK_RECURSION) return;
    for await (const block of listBlockChildren<AnyBlock>(blockId)) {
      if (block.type === 'child_page') {
        found.push({ id: block.id, title: block.child_page?.title?.trim() ?? '' });
      } else if (block.has_children) {
        await recurse(block.id, blockDepth + 1);
      }
    }
  }
}

async function discoverPageTree(root: PageConfig): Promise<DiscoveredPage[]> {
  const all: DiscoveredPage[] = [
    { pageId: root.id, title: root.name, breadcrumbs: [], depth: 0 },
  ];
  let frontier: DiscoveredPage[] = [all[0]!];

  while (frontier.length > 0) {
    const next: DiscoveredPage[] = [];
    for (const node of frontier) {
      if (node.depth >= MAX_TREE_DEPTH) continue;
      let children: Array<{ id: string; title: string }>;
      try {
        children = await collectChildPagesInPage(node.pageId);
      } catch (err) {
        console.error(
          `  child enumeration failed for ${node.pageId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      for (const child of children) {
        const dp: DiscoveredPage = {
          pageId: child.id,
          title: child.title || child.id,
          breadcrumbs: [...node.breadcrumbs, node.title],
          depth: node.depth + 1,
        };
        all.push(dp);
        next.push(dp);
      }
    }
    frontier = next;
  }
  return all;
}

export interface PageSyncStats {
  pages_configured: number;
  pages_discovered: number;
  pages_synced: number;
  pages_skipped_archived: number;
  pages_skipped_empty: number;
  pages_skipped_error: number;
  chunks_written: number;
}

export async function syncPages(): Promise<PageSyncStats> {
  const roots = parsePageList();
  const stats: PageSyncStats = {
    pages_configured: roots.length,
    pages_discovered: 0,
    pages_synced: 0,
    pages_skipped_archived: 0,
    pages_skipped_empty: 0,
    pages_skipped_error: 0,
    chunks_written: 0,
  };
  if (roots.length === 0) {
    console.log('notion-pages: NOTION_SYNC_PAGE_IDS not set, skipping');
    return stats;
  }

  for (const root of roots) {
    console.log(`notion-pages: syncing root "${root.name}" (${root.id})`);
    let tree: DiscoveredPage[];
    try {
      tree = await discoverPageTree(root);
    } catch (err) {
      stats.pages_skipped_error += 1;
      console.error(
        `  failed to enumerate root ${root.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    console.log(`  discovered ${tree.length} page(s) in tree`);

    for (const node of tree) {
      stats.pages_discovered += 1;
      try {
        const written = await syncOnePage(root, node);
        if (written === -1) {
          stats.pages_skipped_archived += 1;
        } else if (written === 0) {
          stats.pages_skipped_empty += 1;
        } else {
          stats.chunks_written += written;
          stats.pages_synced += 1;
        }
      } catch (err) {
        stats.pages_skipped_error += 1;
        console.error(
          `  failed page ${node.pageId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return stats;
}

async function syncOnePage(root: PageConfig, node: DiscoveredPage): Promise<number> {
  const page = await getPage<NotionPage>(node.pageId);
  if (page.archived) return -1;

  const propTitle = extractTitle(page.properties);
  const displayTitle = propTitle || node.title || node.pageId;

  const bodyText = await walkPageBlocks(node.pageId);

  const headerLines: string[] = [`# ${displayTitle}`, `Source: ${root.name}`];
  if (node.breadcrumbs.length > 0) {
    headerLines.push(`Path: ${[...node.breadcrumbs, displayTitle].join(' > ')}`);
  }
  const fullText = [...headerLines, '', bodyText].join('\n').trim();
  if (!fullText || fullText.length < 20) return 0;

  const chunks = chunkText(fullText);
  if (chunks.length === 0) return 0;

  const embeddings = await embedBatch(chunks);

  await prisma.$executeRaw`
    DELETE FROM document_chunks
    WHERE source = 'notion'
      AND source_id LIKE ${'notion:' + node.pageId + ':%'}
  `;

  for (let i = 0; i < chunks.length; i += 1) {
    const id = crypto.randomUUID();
    const sourceId = `notion:${node.pageId}:${i}`;
    const content = chunks[i]!;
    const embedding = embeddings[i]!;
    const embeddingLiteral = `[${embedding.join(',')}]`;
    const metadata = {
      subtype: 'document',
      notion_page_id: node.pageId,
      root_page_id: root.id,
      root_page_name: root.name,
      breadcrumbs: node.breadcrumbs,
      depth: node.depth,
      last_edited_time: page.last_edited_time,
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
        ${displayTitle || null},
        ${content},
        ${embeddingLiteral}::vector(1536),
        ${metadataJson}::jsonb,
        NOW()
      )
    `;
  }

  return chunks.length;
}
