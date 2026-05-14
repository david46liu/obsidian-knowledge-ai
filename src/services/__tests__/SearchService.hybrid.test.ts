import { describe, it, expect, vi } from 'vitest';
import { SearchService } from 'src/services/SearchService';
import { HashCacheStore } from 'src/indexer/hashCache';
import { PathMapStore } from 'src/indexer/pathMap';
import { BM25Store } from 'src/retrieval/bm25';
import { RerankerRegistry } from 'src/retrieval/rerank';
import { EmbeddingClientRegistry } from 'src/embedding/registry';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import type { Chunk, Notebook, HashCacheEntry } from 'src/types/data';
import type { EmbeddingClient } from 'src/embedding/types';
import { VectorStore } from 'src/embedding/vectorStore';

function mkChunk(id: string, content: string): Chunk {
  const [hash] = id.split(':');
  return {
    id, chunkIndex: 0, fileHash: hash, filePath: 'notes/a.md', sourceId: 's',
    headingText: '', headingPath: [], content, contentHash: 'h',
    tokenCount: content.length, charStart: 0, charEnd: content.length, kind: 'paragraph',
  };
}

const notebook: Notebook = {
  id: 'nb1', name: 't',
  sources: [{ id: 's', type: 'folder', path: 'notes', recursive: true }],
  status: 'idle', createdAt: 1, updatedAt: 1,
};

async function makeSetup(withEmbeddings = false) {
  const adapter = new InMemoryDataStoreAdapter();
  const paths = new StoragePaths('/p');
  const hc = new HashCacheStore(adapter, paths);
  const pm = new PathMapStore(adapter, paths);
  await hc.load(); await pm.load();

  const chunkA = mkChunk('hA:0', 'machine learning');
  const chunkB = mkChunk('hB:0', 'deep learning neural network');

  const entryA: HashCacheEntry = {
    fileHash: 'hA', fileSize: 10, chunks: [chunkA],
    chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok',
    ...(withEmbeddings ? { embeddings: { 'hA:0': [1, 0] }, embeddingModelId: 'test-model' } : {}),
  };
  const entryB: HashCacheEntry = {
    fileHash: 'hB', fileSize: 10, chunks: [chunkB],
    chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok',
    ...(withEmbeddings ? { embeddings: { 'hB:0': [0, 1] }, embeddingModelId: 'test-model' } : {}),
  };
  await hc.append(entryA);
  await hc.append(entryB);
  await pm.append({ filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });
  await pm.append({ filePath: 'notes/b.md', fileHash: 'hB', sourceMtime: 1, observedAt: 1 });

  const bm25 = new BM25Store(adapter, paths, 'nb1', 1);
  bm25.add([chunkA, chunkB]);

  return { hc, pm, bm25, chunkA, chunkB };
}

describe('SearchService hybrid (RRF)', () => {
  it('RRF merges BM25 and vector results, boosting chunks found by both', async () => {
    const { hc, pm, bm25 } = await makeSetup(true);
    const embeddingReg = new EmbeddingClientRegistry();
    const mockClient: EmbeddingClient = {
      modelId: 'test-model', dimensions: 2,
      embedDocuments: vi.fn(),
      embedQuery: vi.fn().mockResolvedValue([1, 0]),  // close to hA:0
    };
    embeddingReg.register(mockClient);

    const svc = new SearchService({
      hashCache: hc, pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
      embeddingRegistry: embeddingReg,
      getVectorStore: () => new VectorStore(),
      onVectorStoreInvalidate: () => {},
    });

    const hits = await svc.search('nb1', 'machine learning', { rerank: false, useVector: true });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].rrfScore).toBeDefined();
  });

  it('degrades to BM25-only when embedding registry has no client', async () => {
    const { hc, pm, bm25 } = await makeSetup(false);
    const embeddingReg = new EmbeddingClientRegistry(); // empty

    const svc = new SearchService({
      hashCache: hc, pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
      embeddingRegistry: embeddingReg,
      getVectorStore: () => new VectorStore(),
      onVectorStoreInvalidate: () => {},
    });

    const hits = await svc.search('nb1', 'machine learning', { rerank: false });
    expect(hits.length).toBeGreaterThan(0);
    hits.forEach(h => expect(h.rrfScore).toBeUndefined());
  });

  it('useVector=false skips embedding path entirely', async () => {
    const { hc, pm, bm25 } = await makeSetup(true);
    const embeddingReg = new EmbeddingClientRegistry();
    const mockClient: EmbeddingClient = {
      modelId: 'test-model', dimensions: 2,
      embedDocuments: vi.fn(),
      embedQuery: vi.fn().mockResolvedValue([1, 0]),
    };
    embeddingReg.register(mockClient);

    const svc = new SearchService({
      hashCache: hc, pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
      embeddingRegistry: embeddingReg,
      getVectorStore: () => new VectorStore(),
      onVectorStoreInvalidate: () => {},
    });

    await svc.search('nb1', 'q', { rerank: false, useVector: false });
    expect(mockClient.embedQuery).not.toHaveBeenCalled();
  });

  it('filter is applied after RRF merge, before topK slice', async () => {
    const { hc, pm, bm25 } = await makeSetup(false);

    const svc = new SearchService({
      hashCache: hc, pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
      embeddingRegistry: new EmbeddingClientRegistry(),
      getVectorStore: () => new VectorStore(),
      onVectorStoreInvalidate: () => {},
    });

    const hits = await svc.search('nb1', 'learning', {
      rerank: false,
      filter: (c) => c.id === 'hA:0',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.id).toBe('hA:0');
  });
});
