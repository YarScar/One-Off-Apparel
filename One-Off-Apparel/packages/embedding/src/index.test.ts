import { afterEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      embeddings = { create: createMock };
      static APIError = class APIError extends Error {
        status: number | undefined;
        constructor(message: string, status?: number) {
          super(message);
          this.status = status;
        }
      };
    },
  };
});

import { embedBatch, embedText, resetClient } from './index.js';

afterEach(() => {
  createMock.mockReset();
  resetClient();
  delete process.env['OPENAI_API_KEY'];
});

function withKey(): void {
  process.env['OPENAI_API_KEY'] = 'sk-test';
}

describe('embedText', () => {
  it('returns the embedding from the OpenAI response', async () => {
    withKey();
    createMock.mockResolvedValueOnce({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    const result = await embedText('hello');
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('throws when OPENAI_API_KEY is missing', async () => {
    await expect(embedText('x')).rejects.toThrow(/OPENAI_API_KEY/);
  });
});

describe('embedBatch', () => {
  it('returns one embedding per input', async () => {
    withKey();
    createMock.mockResolvedValueOnce({
      data: [{ embedding: [1] }, { embedding: [2] }, { embedding: [3] }],
    });
    const result = await embedBatch(['a', 'b', 'c']);
    expect(result).toEqual([[1], [2], [3]]);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('chunks inputs into BATCH_SIZE=100 calls', async () => {
    withKey();
    const inputs = Array.from({ length: 150 }, (_, i) => `t${i.toString()}`);
    createMock
      .mockResolvedValueOnce({
        data: Array.from({ length: 100 }, () => ({ embedding: [0] })),
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, () => ({ embedding: [0] })),
      });
    const result = await embedBatch(inputs);
    expect(result).toHaveLength(150);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('returns empty array on empty input without calling the API', async () => {
    withKey();
    const result = await embedBatch([]);
    expect(result).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('throws when embedding count does not match input count', async () => {
    withKey();
    createMock.mockResolvedValueOnce({
      data: [{ embedding: [1] }],
    });
    await expect(embedBatch(['a', 'b'])).rejects.toThrow(/embeddings/);
  });
});
