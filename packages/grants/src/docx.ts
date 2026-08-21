/**
 * `.docx` text extraction — a straight port of
 * `.claude/skills/grant-writing/scripts/corpus_search.py`'s `paragraphs()`, so the
 * production text-fetch tool (`get_grant_document_text`) and the dev-only local-mirror
 * fallback produce the same output for the same file. Keep the two in sync if either
 * changes; see WP #323.
 *
 * A `.docx` is a zip; the text lives in `word/document.xml` as a run of `<w:p>` paragraph
 * elements. This does not attempt general OOXML parsing — no tables, styles, or runs are
 * distinguished — because the corpus is read for its prose, not its formatting.
 */
import JSZip from 'jszip';

/** The handful of entities `word/document.xml` actually contains, plus numeric refs. */
function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Extracts one paragraph per `<w:p>`, stripped of markup and collapsed to single-spaced text. */
export async function extractDocxParagraphs(bytes: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith('.xml') || !name.includes('word/document')) continue;
    const xml = await zip.files[name]?.async('string');
    if (xml === undefined) continue;
    const withBreaks = xml.replace(/<\/w:p>/g, '\n');
    const stripped = withBreaks.replace(/<[^>]+>/g, '');
    for (const line of unescapeXml(stripped).split('\n')) {
      const collapsed = line.trim().split(/\s+/).join(' ');
      if (collapsed) out.push(collapsed);
    }
  }
  return out;
}

/** Convenience wrapper: the whole document as one string, paragraphs newline-joined. */
export async function extractDocxText(bytes: Buffer): Promise<string> {
  return (await extractDocxParagraphs(bytes)).join('\n');
}
