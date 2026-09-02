import { listBlockChildren } from './notion-client.js';

interface RichTextItem {
  plain_text?: string;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  paragraph?: { rich_text: RichTextItem[] };
  heading_1?: { rich_text: RichTextItem[] };
  heading_2?: { rich_text: RichTextItem[] };
  heading_3?: { rich_text: RichTextItem[] };
  bulleted_list_item?: { rich_text: RichTextItem[] };
  numbered_list_item?: { rich_text: RichTextItem[] };
  to_do?: { rich_text: RichTextItem[]; checked?: boolean };
  toggle?: { rich_text: RichTextItem[] };
  quote?: { rich_text: RichTextItem[] };
  callout?: { rich_text: RichTextItem[] };
  code?: { rich_text: RichTextItem[]; language?: string };
}

const INDEXED_BLOCK_TYPES = new Set([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
]);

// Block types that contain children worth indexing but have no text of their own.
// The walker recurses into these without extracting text from the parent block.
const CONTAINER_BLOCK_TYPES = new Set([
  'transcription',  // Notion AI Meeting Notes wrapper
  'column_list',
  'column',
  'synced_block',
  'template',
]);

const MAX_RECURSION_DEPTH = 5;

function richTextToPlain(rt: RichTextItem[] | undefined): string {
  if (!rt) return '';
  return rt.map((r) => r.plain_text ?? '').join('');
}

function formatBlockText(block: NotionBlock): string {
  switch (block.type) {
    case 'paragraph':
      return richTextToPlain(block.paragraph?.rich_text);
    case 'heading_1':
      return '# ' + richTextToPlain(block.heading_1?.rich_text);
    case 'heading_2':
      return '## ' + richTextToPlain(block.heading_2?.rich_text);
    case 'heading_3':
      return '### ' + richTextToPlain(block.heading_3?.rich_text);
    case 'bulleted_list_item':
      return '- ' + richTextToPlain(block.bulleted_list_item?.rich_text);
    case 'numbered_list_item':
      return '1. ' + richTextToPlain(block.numbered_list_item?.rich_text);
    case 'to_do': {
      const checked = block.to_do?.checked ? 'x' : ' ';
      return `- [${checked}] ` + richTextToPlain(block.to_do?.rich_text);
    }
    case 'toggle':
      return richTextToPlain(block.toggle?.rich_text);
    case 'quote':
      return '> ' + richTextToPlain(block.quote?.rich_text);
    case 'callout':
      return richTextToPlain(block.callout?.rich_text);
    default:
      return '';
  }
}

export async function walkPageBlocks(pageId: string): Promise<string> {
  const lines: string[] = [];
  await walk(pageId, 0, lines);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function walk(blockId: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_RECURSION_DEPTH) return;
  for await (const block of listBlockChildren<NotionBlock>(blockId)) {
    if (INDEXED_BLOCK_TYPES.has(block.type)) {
      const text = formatBlockText(block);
      if (text.trim()) {
        const indent = '  '.repeat(depth);
        out.push(indent + text);
      }
      if (block.has_children) {
        await walk(block.id, depth + 1, out);
      }
    } else if (CONTAINER_BLOCK_TYPES.has(block.type) && block.has_children) {
      // Recurse into container blocks without extracting text from the parent.
      await walk(block.id, depth, out);
    }
  }
}
