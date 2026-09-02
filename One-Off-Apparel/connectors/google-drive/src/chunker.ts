const TARGET_CHARS = 1000;
const MAX_CHARS = 1400;
const OVERLAP_CHARS = 200;

export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= MAX_CHARS) return [trimmed];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    const end = Math.min(cursor + TARGET_CHARS, trimmed.length);
    let cut = end;

    if (end < trimmed.length) {
      const nlSearchStart = Math.max(cursor + TARGET_CHARS - 200, cursor);
      const nlIdx = trimmed.lastIndexOf('\n', Math.min(cursor + MAX_CHARS, trimmed.length));
      if (nlIdx > nlSearchStart) {
        cut = nlIdx;
      } else {
        const sentEnd = trimmed.indexOf('. ', cursor + TARGET_CHARS - 100);
        if (sentEnd !== -1 && sentEnd < cursor + MAX_CHARS) {
          cut = sentEnd + 1;
        }
      }
    }

    const chunk = trimmed.slice(cursor, cut).trim();
    if (chunk.length > 0) chunks.push(chunk);

    if (cut >= trimmed.length) break;
    cursor = Math.max(cut - OVERLAP_CHARS, cursor + 1);
  }
  return chunks;
}
