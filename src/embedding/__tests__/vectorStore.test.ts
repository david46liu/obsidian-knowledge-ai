import { describe, it, expect } from 'vitest';
import { VectorStore } from 'src/embedding/vectorStore';
import { HashCacheStore } from 'src/indexer/hashCache';
import { PathMapStore } from 'src/indexer/pathMap';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import type { HashCacheEntry } from 'src/types/data';

function mkEntry(hash: string, modelId: string, chunkIds: string[], vecs: number[][]): HashCacheEntry {
  const embeddings: Record<string, number[]> = {};
  chunkIds.forEach((id, i) => { embeddings[id] = vecs[i]; });
  return {
    fileHash: hash, fileSize: 10,
    chunks: chunkIds.map((id, i) => ({
      id, chunkIndex: i, fileHash: hash, filePath: 'a.md', sourceId: 's',
      headingText: '', headingPath: [], content: 'x', contentHash: 'h',
      tokenCount: 1, charStart: 0, charEnd: 1, kind: 'paragraph' as const,
    })),
    embeddings,
    embeddingModelId: modelId,
    chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok',
  };
}

async function makeStores() {
  const adapter = new InMemoryDataStoreAdapter();
  const paths = new StoragePaths('/p');
  const hc = new HashCacheStore(adapter, paths);
  const pm = new PathMapStore(adapter, paths);
  await hc.load(); await pm.load();
  return { hc, pm, paths };
}

const NOTEBOOK = {
  id: 'nb1', name: 't',
  sources: [{ id: 's', type: 'folder' as const, path: '', recursive: true }],
  status: 'idle' as const, createdAt: 1, updatedAt: 1,
};

describe('VectorStore', () => {
  it('loads vectors matching currentModelId only', async () => {
    const { hc, pm } = await makeStores();
    await hc.append(mkEntry('hA', 'model-v1', ['hA:0'], [[1, 0, 0]]));
    await hc.append(mkEntry('hB', 'model-v2', ['hB:0'], [[0, 1, 0]]));
    await pm.append({ filePath: 'a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });
    await pm.append({ filePath: 'b.md', fileHash: 'hB', sourceMtime: 1, observedAt: 1 });

    const store = new VectorStore();
    await store.load('nb1', hc, pm, 'model-v1', NOTEBOOK);
    expect(store.isReady()).toBe(true);

    const results = store.search(new Float32Array([1, 0, 0]), 5);
    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe('hA:0');
  });

  it('search returns top-K by cosine similarity', async () => {
    const { hc, pm } = await makeStores();
    const entry = mkEntry('hA', 'model-v1',
      ['hA:0', 'hA:1', 'hA:2'],
      [[1, 0, 0], [0.9, 0.1, 0], [0, 1, 0]]
    );
    await hc.append(entry);
    await pm.append({ filePath: 'a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });

    const store = new VectorStore();
    await store.load('nb1', hc, pm, 'model-v1', NOTEBOOK);

    const results = store.search(new Float32Array([1, 0, 0]), 2);
    expect(results).toHaveLength(2);
    expect(results[0].chunkId).toBe('hA:0');
    expect(results[0].score).toBeCloseTo(1.0, 5);
    expect(results[1].chunkId).toBe('hA:1');
  });

  it('clear() makes isReady() return false', async () => {
    const { hc, pm } = await makeStores();
    await hc.append(mkEntry('hA', 'm', ['hA:0'], [[1]]));
    await pm.append({ filePath: 'a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });

    const store = new VectorStore();
    await store.load('nb1', hc, pm, 'm', NOTEBOOK);
    expect(store.isReady()).toBe(true);
    store.clear();
    expect(store.isReady()).toBe(false);
  });

  it('load respects AbortSignal', async () => {
    const { hc, pm } = await makeStores();
    const controller = new AbortController();
    controller.abort();
    const store = new VectorStore();
    await expect(
      store.load('nb1', hc, pm, 'm', NOTEBOOK, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
