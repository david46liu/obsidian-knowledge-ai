import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIEmbeddingClient, BatchTooLargeError } from 'src/embedding/apiEmbeddingClient';

const FAKE_BASE = 'https://api.example.com';
const FAKE_KEY = 'sk-test';
const FAKE_MODEL = 'text-embedding-3-small';

function mockFetch(vectors: number[][]): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: vectors.map((v, i) => ({ index: i, embedding: v })),
    }),
  } as Response);
}

describe('APIEmbeddingClient', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('embedDocuments returns vectors for each text', async () => {
    const vecs = [[1, 0, 0], [0, 1, 0]];
    globalThis.fetch = mockFetch(vecs);
    const client = new APIEmbeddingClient({
      baseUrl: FAKE_BASE, apiKey: FAKE_KEY, model: FAKE_MODEL, providerId: 'p1',
    });
    const result = await client.embedDocuments(['a', 'b']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([1, 0, 0]);
  });

  it('embedQuery calls fetch with single-element array and returns first vector', async () => {
    globalThis.fetch = mockFetch([[0.5, 0.5]]);
    const client = new APIEmbeddingClient({
      baseUrl: FAKE_BASE, apiKey: FAKE_KEY, model: FAKE_MODEL, providerId: 'p1',
    });
    const result = await client.embedQuery('hello');
    expect(result).toEqual([0.5, 0.5]);
  });

  it('strips trailing /v1 from baseUrl before appending /v1/embeddings', async () => {
    globalThis.fetch = mockFetch([[1]]);
    const client = new APIEmbeddingClient({
      baseUrl: 'https://api.example.com/v1', apiKey: FAKE_KEY, model: FAKE_MODEL, providerId: 'p1',
    });
    await client.embedQuery('test');
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe('https://api.example.com/v1/embeddings');
    expect(url).not.toContain('/v1/v1/');
  });

  it('throws BatchTooLargeError when texts.length > 96', async () => {
    const client = new APIEmbeddingClient({
      baseUrl: FAKE_BASE, apiKey: FAKE_KEY, model: FAKE_MODEL, providerId: 'p1',
    });
    const texts = Array.from({ length: 97 }, (_, i) => `text ${i}`);
    await expect(client.embedDocuments(texts)).rejects.toBeInstanceOf(BatchTooLargeError);
  });

  it('respects AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const client = new APIEmbeddingClient({
      baseUrl: FAKE_BASE, apiKey: FAKE_KEY, model: FAKE_MODEL, providerId: 'p1',
    });
    await expect(client.embedQuery('q', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws on non-ok HTTP response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'Unauthorized',
    } as Response);
    const client = new APIEmbeddingClient({
      baseUrl: FAKE_BASE, apiKey: FAKE_KEY, model: FAKE_MODEL, providerId: 'p1',
    });
    await expect(client.embedQuery('q')).rejects.toThrow('401');
  });
});
