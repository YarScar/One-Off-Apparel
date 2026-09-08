# Phase 6 — Embeddings + pgvector Search

**Goal:** Build the `@lp-ai/lib-embedding` package that wraps OpenAI's `text-embedding-3-large` model, wire it into the Drive connector, and verify cosine-similarity search works against the `document_chunks` table.

**Prerequisites:**
- Phase 4 complete — `document_chunks` table with `vector(1536)` column exists
- Phase 5 complete — Drive connector populates `document_chunks` (content only, no embeddings yet)
- `OPENAI_API_KEY` in `.env`

---

## 1. Scaffold `@lp-ai/lib-embedding`

```bash
mkdir -p "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/packages/embedding/src"
```

**`packages/embedding/package.json`:**
```json
{
  "name": "@lp-ai/lib-embedding",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "openai": "^4.52.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
```

**`packages/embedding/src/index.ts`:**
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });

const MODEL = 'text-embedding-3-large';
const DIMENSIONS = 1536;
const BATCH_SIZE = 100;

export async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: MODEL,
    input: text,
    dimensions: DIMENSIONS,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding) throw new Error('No embedding returned from OpenAI');
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: MODEL,
      input: batch,
      dimensions: DIMENSIONS,
    });
    results.push(...response.data.map((d) => d.embedding));
    if (i + BATCH_SIZE < texts.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return results;
}

export { DIMENSIONS, MODEL };
```

---

## 2. Wire embeddings into the Drive connector

Update `connectors/google-drive/src/sync-drive.ts` to embed each chunk after upsert:

```typescript
import { embedText } from '@lp-ai/lib-embedding';
import { prisma } from '@lp-ai/lib-db';

// After upserting chunk content:
const embedding = await embedText(chunk.content);

await prisma.$executeRaw`
  UPDATE document_chunks
  SET embedding = ${JSON.stringify(embedding)}::vector
  WHERE id = ${chunk.id}
`;
```

---

## 3. Create a cosine-similarity search helper

**`packages/embedding/src/search.ts`:**
```typescript
import { prisma } from '@lp-ai/lib-db';
import { embedText } from './index.js';

export interface SearchResult {
  id: string;
  source: string;
  title: string | null;
  content: string;
  similarity: number;
}

export async function searchDocuments(
  query: string,
  limit = 5,
  source?: string,
): Promise<SearchResult[]> {
  const queryEmbedding = await embedText(query);
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

  const sourceFilter = source ? `AND source = '${source}'` : '';

  const results = await prisma.$queryRawUnsafe<SearchResult[]>(`
    SELECT
      id,
      source,
      title,
      content,
      1 - (embedding <=> '${embeddingLiteral}'::vector) AS similarity
    FROM document_chunks
    WHERE embedding IS NOT NULL
    ${sourceFilter}
    ORDER BY embedding <=> '${embeddingLiteral}'::vector
    LIMIT ${limit}
  `);

  return results;
}
```

---

## 4. Create an ivfflat index for search performance

Once you have more than a few hundred rows, add an approximate nearest-neighbor index.
Run this in `psql` against RDS:

```sql
CREATE INDEX document_chunks_embedding_idx
  ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

> Only create this index after inserting at least a few hundred rows — it needs data to build efficiently.

---

## 5. Test the search

Create a quick test script at `packages/embedding/src/test-search.ts`:

```typescript
import { searchDocuments } from './search.js';

const results = await searchDocuments('student work experience', 5);
console.log(results.map((r) => ({ title: r.title, similarity: r.similarity })));
```

Run it:
```bash
node --env-file=../../.env --import tsx packages/embedding/src/test-search.ts
```

---

## Verification checklist

- [ ] `pnpm sync:drive` now populates `embedding` column (not null)
- [ ] `SELECT COUNT(*) FROM document_chunks WHERE embedding IS NOT NULL` returns > 0
- [ ] Test search script returns results with `similarity > 0.7` for relevant queries
- [ ] `pnpm --filter @lp-ai/lib-embedding build` passes without type errors

---

## Known pitfalls

- **`text-embedding-3-large` produces 3072 dimensions by default** — we pass `dimensions: 1536` to halve cost/storage without significant quality loss. The schema must match: `vector(1536)`.
- **Rate limits** — OpenAI embeddings API has a default limit of 3,000 RPM. The batch helper adds a 100ms pause between batches to stay safe.
- **NULL embeddings after sync** — Drive connector must explicitly set the embedding after the upsert. Check that the embedding step isn't being skipped on conflict.

---

**Next:** [07-mcp-server.md](07-mcp-server.md)
