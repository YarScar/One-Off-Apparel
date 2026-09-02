import OpenAI from 'openai';

export const MODEL = 'text-embedding-3-large';
export const DIMENSIONS = 1536;
const BATCH_SIZE = 100;
const INTER_BATCH_DELAY_MS = 100;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 500;

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  client = new OpenAI({ apiKey });
  return client;
}

export function resetClient(): void {
  client = undefined;
}

export async function embedText(text: string): Promise<number[]> {
  const client = getClient();
  const response = await withRetry(() =>
    client.embeddings.create({
      model: MODEL,
      input: text,
      dimensions: DIMENSIONS,
    }),
  );
  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error('No embedding returned from OpenAI');
  }
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getClient();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await withRetry(() =>
      client.embeddings.create({
        model: MODEL,
        input: batch,
        dimensions: DIMENSIONS,
      }),
    );
    if (response.data.length !== batch.length) {
      throw new Error(
        `OpenAI returned ${String(response.data.length)} embeddings for ${String(batch.length)} inputs`,
      );
    }
    for (const item of response.data) {
      results.push(item.embedding);
    }
    if (i + BATCH_SIZE < texts.length) {
      await sleep(INTER_BATCH_DELAY_MS);
    }
  }

  return results;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES - 1) {
        throw err;
      }
      const delay = BASE_BACKOFF_MS * 2 ** attempt;
      await sleep(delay);
    }
  }
  throw lastError;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    if (err.status === undefined) return true;
    if (err.status === 429) return true;
    if (err.status >= 500) return true;
    return false;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
