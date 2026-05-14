import { describe, it, expect, vi } from 'vitest';
import { SearchService } from 'src/services/SearchService';
import { HashCacheStore } from 'src/indexer/hashCache';
import { PathMapStore } from 'src/indexer/pathMap';
import { BM25Store } from 'src/retrieval/bm25';
import { RerankerRegistry } from 'src/retrieval/rerank';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import type { Chunk, Notebook, SearchHit } from 'src/types/data';
import type { Reranker } from 'src/retrieval/types';

function mkChunk(id: string, content: string, filePath = 'notes/a.md'): Chunk {
  return {
    id, chunkIndex: Number(id.split(':')[1] ?? 0),
    fileHash: id.split(':')[0], filePath, sourceId: 's',
    headingText: '', headingPath: [],
    content, contentHash: 'h', tokenCount: content.length,
    charStart: 0, charEnd: content.length, kind: 'paragraph',
  };
}

async function setup() {
  const adapter = new InMemoryDataStoreAdapter();
  const paths = new StoragePaths('/p');
  const hc = new HashCacheStore(adapter, paths);
  const pm = new PathMapStore(adapter, paths);
  await hc.load(); await pm.load();
  const bm25 = new BM25Store(adapter, paths, 'nb1', 1);
  const chunk = mkChunk('hA:0', '机器学习笔记');
  await hc.append({
    fileHash: 'hA', fileSize: 10, chunks: [chunk],
    chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok',
  });
  await pm.append({ filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });
  bm25.add([chunk]);
  return { adapter, paths, hc, pm, bm25, chunk };
}

const notebook: Notebook = {
  id: 'nb1', name: 't',
  sources: [{ id: 's', type: 'folder', path: 'notes', recursive: true }],
  status: 'idle', createdAt: 1, updatedAt: 1,
};

describe('SearchService', () => {
  it('returns BM25 hits with finalRank', async () => {
    const { hc, pm, bm25 } = await setup();
    const rerankers = new RerankerRegistry();
    const svc = new SearchService({
      hashCache: hc,
      pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers,
      resolveRerankerName: () => undefined,
    });
    const hits = await svc.search('nb1', '机器学习', { rerank: false, topK: 5 });
    expect(hits.length).toBe(1);
    expect(hits[0].chunk.id).toBe('hA:0');
    expect(hits[0].finalRank).toBe(0);
  });

  it('reindexes when notebook is dirty (staleOk=false)', async () => {
    const { hc, pm, bm25 } = await setup();
    const dirty: Notebook = { ...notebook, status: 'dirty' };
    const reindexSpy = vi.fn(async () => {});
    const svc = new SearchService({
      hashCache: hc,
      pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => dirty,
      reindex: reindexSpy,
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
    });
    await svc.search('nb1', 'q');
    expect(reindexSpy).toHaveBeenCalledWith('nb1');
  });

  it('does not reindex when staleOk=true', async () => {
    const { hc, pm, bm25 } = await setup();
    const dirty: Notebook = { ...notebook, status: 'dirty' };
    const reindexSpy = vi.fn(async () => {});
    const svc = new SearchService({
      hashCache: hc,
      pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => dirty,
      reindex: reindexSpy,
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
    });
    await svc.search('nb1', 'q', { staleOk: true });
    expect(reindexSpy).not.toHaveBeenCalled();
  });

  it('invokes reranker when rerank=true and reranker is configured', async () => {
    const { hc, pm, bm25 } = await setup();
    const reranker: Reranker = {
      name: 'test',
      rerank: vi.fn(async (_q: string, hits: SearchHit[]) => hits.map((h, i) => ({ ...h, rerankScore: 99 - i, finalRank: i }))),
    };
    const rerankers = new RerankerRegistry();
    rerankers.register(reranker);
    const svc = new SearchService({
      hashCache: hc,
      pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers,
      resolveRerankerName: () => 'test',
    });
    const hits = await svc.search('nb1', '机器学习', { rerank: true });
    expect(reranker.rerank).toHaveBeenCalled();
    expect(hits[0].rerankScore).toBe(99);
  });

  it('filter option excludes hits', async () => {
    const { hc, pm, bm25 } = await setup();
    const svc = new SearchService({
      hashCache: hc,
      pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
    });
    const hits = await svc.search('nb1', '机器学习', {
      rerank: false,
      filter: (c) => c.id === 'no-such-id',
    });
    expect(hits).toEqual([]);
  });

  it('rewrites hit.chunk.filePath to an alive path when stored path was renamed', async () => {
    const { hc, pm, bm25, chunk } = await setup();
    await pm.append({ filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 0, observedAt: 2, tombstone: true });
    await pm.append({ filePath: 'notes/moved.md', fileHash: 'hA', sourceMtime: 2, observedAt: 2 });

    const svc = new SearchService({
      hashCache: hc,
      pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
    });

    const hits = await svc.search('nb1', '机器学习', { rerank: false });
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.filePath).toBe('notes/moved.md');
  });

  it('keeps original filePath when it is still alive and points at same hash', async () => {
    const { hc, pm, bm25 } = await setup();
    const svc = new SearchService({
      hashCache: hc,
      pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
    });
    const hits = await svc.search('nb1', '机器学习', { rerank: false });
    expect(hits[0].chunk.filePath).toBe('notes/a.md');
  });

  it('**scope-guarded display path**: does NOT leak alive path from another notebook', async () => {
    const { hc, pm, bm25 } = await setup();

    await pm.append({ filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 0, observedAt: 2, tombstone: true });
    await pm.append({ filePath: 'other/leak.md', fileHash: 'hA', sourceMtime: 2, observedAt: 2 });
    await pm.append({ filePath: 'notes/inside.md', fileHash: 'hA', sourceMtime: 2, observedAt: 2 });

    const svc = new SearchService({
      hashCache: hc,
      pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
    });

    const hits = await svc.search('nb1', '机器学习', { rerank: false });
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.filePath).toBe('notes/inside.md');
    expect(hits[0].chunk.filePath).not.toBe('other/leak.md');
  });

  it('scope-guarded: falls back to original filePath when no alive path in scope', async () => {
    const { hc, pm, bm25 } = await setup();
    await pm.append({ filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 0, observedAt: 2, tombstone: true });
    await pm.append({ filePath: 'other/leak.md', fileHash: 'hA', sourceMtime: 2, observedAt: 2 });

    const svc = new SearchService({
      hashCache: hc,
      pathMap: pm,
      getBM25: () => bm25,
      getNotebook: async () => notebook,
      reindex: async () => {},
      ensureBM25ForNotebook: async () => {},
      rerankers: new RerankerRegistry(),
      resolveRerankerName: () => undefined,
    });

    const hits = await svc.search('nb1', '机器学习', { rerank: false });
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.filePath).toBe('notes/a.md');
  });
});
