import { describe, it, expect, vi } from 'vitest';
import { LocalEmbeddingClient } from 'src/embedding/localEmbeddingClient';
import type { EmbeddingWorkerHost } from 'src/embedding/worker/EmbeddingWorkerHost';

function mockHost(returnVectors: number[][]): EmbeddingWorkerHost {
  return {
    embed: vi.fn().mockResolvedValue(returnVectors),
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn(),
  } as unknown as EmbeddingWorkerHost;
}

describe('LocalEmbeddingClient', () => {
  it('embedDocuments delegates to host.embed with type=document', async () => {
    const vecs = [[1, 0], [0, 1]];
    const host = mockHost(vecs);
    const client = new LocalEmbeddingClient({ host, modelId: 'Xenova/multilingual-e5-small', dimensions: 2 });
    const result = await client.embedDocuments(['a', 'b']);
    expect(result).toEqual(vecs);
    expect(host.embed).toHaveBeenCalledWith(
      expect.objectContaining({ texts: ['a', 'b'], type: 'document' })
    );
  });

  it('embedQuery delegates to host.embed with type=query and returns first vector', async () => {
    const host = mockHost([[0.5, 0.5]]);
    const client = new LocalEmbeddingClient({ host, modelId: 'Xenova/multilingual-e5-small', dimensions: 2 });
    const result = await client.embedQuery('hello');
    expect(result).toEqual([0.5, 0.5]);
    expect(host.embed).toHaveBeenCalledWith(
      expect.objectContaining({ texts: ['hello'], type: 'query' })
    );
  });

  it('passes AbortSignal through to host.embed', async () => {
    const host = mockHost([[1]]);
    const client = new LocalEmbeddingClient({ host, modelId: 'Xenova/multilingual-e5-small', dimensions: 1 });
    const sig = AbortSignal.timeout(5000);
    await client.embedQuery('q', { signal: sig });
    expect(host.embed).toHaveBeenCalledWith(expect.objectContaining({ signal: sig }));
  });
});
