import { describe, it, expect, vi } from 'vitest';
import { runPipeline } from 'src/indexer/pipeline';
import { HashCacheStore } from 'src/indexer/hashCache';
import { PathMapStore } from 'src/indexer/pathMap';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import { createEventBus } from 'src/infra/eventBus';
import { makeFakeClock } from 'src/infra/clock';
import type { Chunk } from 'src/types/data';
import type { ScanResult } from 'src/indexer/types';
import type { IndexerEventMap } from 'src/indexer/events';
import type { BM25Handle, ChunkProducer } from 'src/indexer/pipeline';

function fakeBM25(): BM25Handle & { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  return {
    added, removed,
    add(chunks: Chunk[]) { chunks.forEach(c => added.push(c.id)); },
    discardByIds(ids: string[]) { ids.forEach(id => removed.push(id)); },
    async persist() {},
  };
}

function fakeProducer(chunksByPath: Record<string, Chunk[]>, hashByPath: Record<string, string>): ChunkProducer {
  return async (path: string) => ({
    kind: 'ok',
    hash: hashByPath[path] ?? 'h' + path,
    size: 1,
    parserVersion: 1,
    chunks: chunksByPath[path] ?? [],
  });
}

function chunk(id: string, hash: string, path: string): Chunk {
  return {
    id, chunkIndex: Number(id.split(':')[1] ?? 0),
    fileHash: hash, filePath: path, sourceId: 's',
    headingText: '', headingPath: [],
    content: 'x', contentHash: 'h', tokenCount: 1,
    charStart: 0, charEnd: 1, kind: 'paragraph',
  };
}

describe('runPipeline', () => {
  it('NEW_PATH: full new file → bm25 add + hashes/paths appended', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    const bm25 = fakeBM25();
    const bus = createEventBus<IndexerEventMap>();

    const scan: ScanResult = {
      entries: [{ classification: 'NEW_PATH', filePath: 'a.md', newHash: 'hA', sourceMtime: 1, fileSize: 1 }],
      scannedFileCount: 1,
    };

    await runPipeline(scan, {
      notebookId: 'nb',
      hashCache: hc, pathMap: pm, bm25,
      producer: fakeProducer({ 'a.md': [chunk('hA:0', 'hA', 'a.md')] }, { 'a.md': 'hA' }),
      clock: makeFakeClock(1000),
      eventBus: bus,
      alivePathsInNotebook: (h) => pm.alivePathsFor(h),
      pathInScope: () => true,
      persistNotebookState: async () => {},
    });

    expect(hc.get('hA')?.fileHash).toBe('hA');
    expect(pm.get('a.md')?.fileHash).toBe('hA');
    expect(bm25.added).toEqual(['hA:0']);
  });

  it('RENAMED: no bm25 add/discard, only path update', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    await hc.append({ fileHash: 'hA', fileSize: 1, chunks: [chunk('hA:0', 'hA', 'old.md')], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });
    await pm.append({ filePath: 'old.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });

    const bm25 = fakeBM25();
    await runPipeline(
      { entries: [{ classification: 'RENAMED', oldPath: 'old.md', newPath: 'new.md', oldHash: 'hA', newHash: 'hA', sourceMtime: 2, fileSize: 1 }], scannedFileCount: 1 },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: fakeProducer({}, {}),
        clock: makeFakeClock(1000),
        eventBus: createEventBus(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    );

    expect(bm25.added).toEqual([]);
    expect(bm25.removed).toEqual([]);
    expect(pm.get('old.md')).toBeUndefined();
    expect(pm.get('new.md')?.fileHash).toBe('hA');
  });

  it('DELETED with duplicate in scope: bm25 NOT discarded', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    await hc.append({ fileHash: 'hA', fileSize: 1, chunks: [chunk('hA:0', 'hA', 'a.md')], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });
    await pm.append({ filePath: 'b.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });

    const bm25 = fakeBM25();
    await runPipeline(
      { entries: [{ classification: 'DELETED', filePath: 'a.md', oldHash: 'hA' }], scannedFileCount: 0 },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: fakeProducer({}, {}),
        clock: makeFakeClock(1000),
        eventBus: createEventBus(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h).filter(p => p !== 'a.md'),
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    );

    expect(bm25.removed).toEqual([]);
    expect(pm.get('a.md')).toBeUndefined();
    expect(hc.get('hA')?.fileHash).toBe('hA');
  });

  it('DELETED with no remaining path: bm25 discarded + hash tombstoned', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    await hc.append({ fileHash: 'hA', fileSize: 1, chunks: [chunk('hA:0', 'hA', 'a.md')], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });

    const bm25 = fakeBM25();
    await runPipeline(
      { entries: [{ classification: 'DELETED', filePath: 'a.md', oldHash: 'hA' }], scannedFileCount: 0 },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: fakeProducer({}, {}),
        clock: makeFakeClock(1000),
        eventBus: createEventBus(),
        alivePathsInNotebook: () => [],
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    );

    expect(bm25.removed).toEqual(['hA:0']);
    expect(hc.get('hA')).toBeUndefined();
  });

  it('hash race guard: producer hash ≠ scan newHash → throws, no persist', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    const bm25 = fakeBM25();

    const driftingProducer: ChunkProducer = async (path: string) => ({
      kind: 'ok', hash: 'hDrifted', size: 1, parserVersion: 1,
      chunks: [chunk('hDrifted:0', 'hDrifted', path)],
    });

    await runPipeline(
      { entries: [{ classification: 'NEW_PATH', filePath: 'a.md', newHash: 'hScanned', sourceMtime: 1, fileSize: 1 }], scannedFileCount: 1 },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: driftingProducer,
        clock: makeFakeClock(1000),
        eventBus: createEventBus<IndexerEventMap>(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    ).catch(() => {});

    expect(hc.get('hScanned')).toBeUndefined();
    expect(hc.get('hDrifted')).toBeUndefined();
    expect(pm.get('a.md')).toBeUndefined();
    expect(bm25.added).toEqual([]);
  });

  it('error retry semantics: producer error does NOT advance PathMap', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    await hc.append({ fileHash: 'hOld', fileSize: 1, chunks: [chunk('hOld:0', 'hOld', 'a.md')], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'hOld', sourceMtime: 100, observedAt: 100 });

    const bm25 = fakeBM25();
    const errorProducer: ChunkProducer = async () => ({ kind: 'error', hash: '', size: 0, parserVersion: 1, errorMessage: 'transient read failure' });

    await runPipeline(
      { entries: [{ classification: 'CONTENT_CHANGED', filePath: 'a.md', oldHash: 'hOld', newHash: 'hNew', sourceMtime: 200, fileSize: 1 }], scannedFileCount: 1 },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: errorProducer,
        clock: makeFakeClock(1000),
        eventBus: createEventBus<IndexerEventMap>(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    ).catch(() => {});

    expect(pm.get('a.md')?.fileHash).toBe('hOld');
    expect(pm.get('a.md')?.sourceMtime).toBe(100);
    expect(hc.getRaw('hNew')?.status).toBe('error');
  });

  it('error entry does NOT short-circuit duplicate: retry re-runs producer', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    await hc.append({ fileHash: 'hNew', fileSize: 1, chunks: [], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'error', errorMessage: 'prev failure' });

    const bm25 = fakeBM25();
    let producerCalls = 0;
    const retryProducer: ChunkProducer = async (path: string) => {
      producerCalls++;
      return { kind: 'ok', hash: 'hNew', size: 1, parserVersion: 1, chunks: [chunk('hNew:0', 'hNew', path)] };
    };

    await runPipeline(
      { entries: [{ classification: 'NEW_PATH', filePath: 'a.md', newHash: 'hNew', sourceMtime: 1, fileSize: 1 }], scannedFileCount: 1 },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: retryProducer,
        clock: makeFakeClock(1000),
        eventBus: createEventBus<IndexerEventMap>(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    );

    expect(producerCalls).toBe(1);
    expect(bm25.added).toEqual(['hNew:0']);
    expect(hc.get('hNew')?.status).toBe('ok');
    expect(pm.get('a.md')?.fileHash).toBe('hNew');
  });

  it('CONTENT_CHANGED: producer error preserves old BM25', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    const oldChunk = chunk('hOld:0', 'hOld', 'a.md');
    await hc.append({ fileHash: 'hOld', fileSize: 1, chunks: [oldChunk], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'hOld', sourceMtime: 100, observedAt: 100 });
    const bm25 = fakeBM25();
    bm25.added.push('hOld:0');

    const errorProducer: ChunkProducer = async () => ({ kind: 'error', hash: '', size: 0, parserVersion: 1, errorMessage: 'transient' });

    await runPipeline(
      { entries: [{ classification: 'CONTENT_CHANGED', filePath: 'a.md', oldHash: 'hOld', newHash: 'hNew', sourceMtime: 200, fileSize: 1 }], scannedFileCount: 1 },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: errorProducer,
        clock: makeFakeClock(1000),
        eventBus: createEventBus<IndexerEventMap>(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    ).catch(() => {});

    expect(bm25.removed).toEqual([]);
    expect(pm.get('a.md')?.fileHash).toBe('hOld');
  });

  it('hash mismatch on CONTENT_CHANGED: old BM25 preserved', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    const oldChunk = chunk('hOld:0', 'hOld', 'a.md');
    await hc.append({ fileHash: 'hOld', fileSize: 1, chunks: [oldChunk], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'hOld', sourceMtime: 100, observedAt: 100 });
    const bm25 = fakeBM25();

    const driftProducer: ChunkProducer = async (path: string) => ({
      kind: 'ok', hash: 'hDrifted', size: 1, parserVersion: 1,
      chunks: [chunk('hDrifted:0', 'hDrifted', path)],
    });

    await runPipeline(
      { entries: [{ classification: 'CONTENT_CHANGED', filePath: 'a.md', oldHash: 'hOld', newHash: 'hScanned', sourceMtime: 200, fileSize: 1 }], scannedFileCount: 1 },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: driftProducer,
        clock: makeFakeClock(1000),
        eventBus: createEventBus<IndexerEventMap>(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    ).catch(() => {});

    expect(bm25.removed).toEqual([]);
    expect(bm25.added).toEqual([]);
    expect(pm.get('a.md')?.fileHash).toBe('hOld');
  });

  it('STALE_PARSER: re-runs producer, updates HashCache & BM25, leaves PathMap intact', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    // Setup: a.md 已 indexed, hash=hA, 旧 chunks=[c1,c2]
    const c1 = chunk('hA:0', 'hA', 'a.md');
    const c2 = chunk('hA:1', 'hA', 'a.md');
    await hc.append({ fileHash: 'hA', fileSize: 10, chunks: [c1, c2], chunkingVersion: 1, parserVersion: 1, indexedAt: 100, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'hA', sourceMtime: 100, observedAt: 100 });

    const bm25 = fakeBM25();
    // 模拟 BM25 已有旧 chunks
    bm25.added.push(c1.id, c2.id);

    // 新 chunks(新 parserVersion=2)
    const c1p = chunk('hA:0', 'hA', 'a.md');
    const c2p = chunk('hA:1', 'hA', 'a.md');
    const staleProducer: ChunkProducer = async () => ({
      kind: 'ok', hash: 'hA', size: 10, parserVersion: 2,
      chunks: [c1p, c2p],
    });

    const recordTransient = vi.fn();

    await runPipeline(
      {
        entries: [{
          classification: 'STALE_PARSER',
          filePath: 'a.md',
          oldHash: 'hA',
          sourceMtime: 100,
          fileSize: 10,
        }],
        scannedFileCount: 1,
      },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: staleProducer,
        clock: makeFakeClock(2000),
        eventBus: createEventBus(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
        recordTransientError: recordTransient,
      }
    );

    // hashCache 已更新到新 parserVersion
    expect(hc.get('hA')?.parserVersion).toBe(2);
    expect(hc.get('hA')?.chunks).toHaveLength(2);
    // BM25 discard 旧 chunks, add 新 chunks
    expect(bm25.removed).toContain(c1.id);
    expect(bm25.removed).toContain(c2.id);
    expect(bm25.added).toContain(c1p.id);
    // pathMap 不变(同一个 hash,无新 entry)
    expect(pm.get('a.md')?.fileHash).toBe('hA');
    expect(recordTransient).not.toHaveBeenCalled();
  });

  it('STALE_PARSER: producer transient → no HashCache write, recordTransient called', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const c1 = chunk('hA:0', 'hA', 'a.md');
    await hc.append({ fileHash: 'hA', fileSize: 10, chunks: [c1], chunkingVersion: 1, parserVersion: 1, indexedAt: 100, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'hA', sourceMtime: 100, observedAt: 100 });

    const bm25 = fakeBM25();
    const transientProducer: ChunkProducer = async () => ({
      kind: 'transient',
      errorMessage: 'timeout',
    });
    const recordTransient = vi.fn();

    await runPipeline(
      {
        entries: [{
          classification: 'STALE_PARSER',
          filePath: 'a.md',
          oldHash: 'hA',
          sourceMtime: 100,
          fileSize: 10,
        }],
        scannedFileCount: 1,
      },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: transientProducer,
        clock: makeFakeClock(2000),
        eventBus: createEventBus(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
        recordTransientError: recordTransient,
      }
    );

    // hashCache 没有新 append(parserVersion 仍然是 1)
    expect(hc.get('hA')?.parserVersion).toBe(1);
    // bm25 没有变动
    expect(bm25.removed).toEqual([]);
    // recordTransientError 调用过
    expect(recordTransient).toHaveBeenCalledWith('a.md', 'timeout');
  });

  it('handleNewContent: producer transient → no HashCache, no PathMap, recordTransient', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const bm25 = fakeBM25();
    const transientProducer: ChunkProducer = async () => ({
      kind: 'transient',
      errorMessage: 'file locked',
    });
    const recordTransient = vi.fn();

    await runPipeline(
      {
        entries: [{
          classification: 'NEW_PATH',
          filePath: 'a.md',
          newHash: 'hA',
          sourceMtime: 1,
          fileSize: 10,
        }],
        scannedFileCount: 1,
      },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: transientProducer,
        clock: makeFakeClock(1000),
        eventBus: createEventBus(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
        recordTransientError: recordTransient,
      }
    );

    // hashCache 没有新 append
    expect(hc.getRaw('hA')).toBeUndefined();
    // pathMap 没有新 entry
    expect(pm.get('a.md')).toBeUndefined();
    // recordTransientError 调用过
    expect(recordTransient).toHaveBeenCalledWith('a.md', 'file locked');
    // 没有抛错(不计入 errors 阈值)
    expect(bm25.added).toEqual([]);
  });

  it('STALE_PARSER: producer skipped → writes stabilizing HashCache entry, no infinite loop', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    // Setup: a.md 已 indexed, hash=hA, parserVersion=1
    const c1 = chunk('hA:0', 'hA', 'a.md');
    await hc.append({ fileHash: 'hA', fileSize: 10, chunks: [c1], chunkingVersion: 1, parserVersion: 1, indexedAt: 100, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'hA', sourceMtime: 100, observedAt: 100 });

    const bm25 = fakeBM25();
    // 模拟 BM25 已有旧 chunk
    bm25.added.push(c1.id);

    // producer 返回 skipped(如: 文件类型不再支持,parserVersion 升到 2)
    const skippedProducer: ChunkProducer = async () => ({
      kind: 'skipped',
      hash: 'hA',
      size: 10,
      parserVersion: 2,
      reason: 'unsupported extension',
    });

    await runPipeline(
      {
        entries: [{
          classification: 'STALE_PARSER',
          filePath: 'a.md',
          oldHash: 'hA',
          sourceMtime: 100,
          fileSize: 10,
        }],
        scannedFileCount: 1,
      },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: skippedProducer,
        clock: makeFakeClock(2000),
        eventBus: createEventBus(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    );

    // HashCache 应写入稳定化 entry: status='skipped', parserVersion=2(新版本,不再触发 STALE_PARSER)
    expect(hc.getRaw('hA')?.status).toBe('skipped');
    expect(hc.getRaw('hA')?.parserVersion).toBe(2);
    expect(hc.getRaw('hA')?.errorMessage).toBe('unsupported extension');
    // BM25 不应有新增 chunk(skipped 不产生 chunks)
    expect(bm25.added).toEqual([c1.id]); // 只有初始的旧 chunk,没有新增
    expect(bm25.removed).toEqual([]); // skipped 也不 discard(chunks 列表为空)
    // pathMap 保持原样
    expect(pm.get('a.md')?.fileHash).toBe('hA');
  });

  it('AbortSignal stops processing between batches', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const bm25 = fakeBM25();
    const abortCtl = new AbortController();
    const entries = Array.from({ length: 120 }, (_, i) => ({
      classification: 'NEW_PATH' as const,
      filePath: `f${i}.md`,
      newHash: `h${i}`,
      sourceMtime: 1,
      fileSize: 1,
    }));
    const chunks: Record<string, Chunk[]> = {};
    const hashes: Record<string, string> = {};
    entries.forEach(e => {
      chunks[e.filePath] = [chunk(`${e.newHash}:0`, e.newHash, e.filePath)];
      hashes[e.filePath] = e.newHash;
    });

    setTimeout(() => abortCtl.abort(), 0);

    await runPipeline(
      { entries, scannedFileCount: entries.length },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: fakeProducer(chunks, hashes),
        clock: makeFakeClock(1000),
        eventBus: createEventBus(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
        signal: abortCtl.signal,
      }
    ).catch(() => {});

    expect(bm25.added.length).toBeLessThan(entries.length);
  });

  it('product.kind === error: records persistent error, does NOT throw, continues with others', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const bm25 = fakeBM25();
    const recordPersistent = vi.fn();
    const producer: ChunkProducer = async (path) => {
      if (path === 'bad.docx') {
        return { kind: 'error', hash: '', size: 0, parserVersion: 1, errorMessage: 'corrupt docx' };
      }
      return { kind: 'ok', hash: 'hGood', size: 1, parserVersion: 1, chunks: [chunk('hGood:0', 'hGood', path)] };
    };

    await runPipeline(
      {
        entries: [
          { classification: 'NEW_PATH', filePath: 'bad.docx', newHash: 'hBad', sourceMtime: 1, fileSize: 10 },
          { classification: 'NEW_PATH', filePath: 'good.md', newHash: 'hGood', sourceMtime: 1, fileSize: 10 },
        ],
        scannedFileCount: 2,
      },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer,
        clock: makeFakeClock(1000),
        eventBus: createEventBus<IndexerEventMap>(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
        recordPersistentError: recordPersistent,
      }
    );

    expect(recordPersistent).toHaveBeenCalledWith('bad.docx', 'corrupt docx');
    // good.md 仍然被索引(error 没阻断 pipeline)
    expect(bm25.added).toContain('hGood:0');
    // bad.docx 的 HashCache 仍记 error
    expect(hc.getRaw('hBad')?.status).toBe('error');
  });

  it('error rate threshold: < MIN_SAMPLES(5) never trips even at 100% error', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const bm25 = fakeBM25();
    // 4 个文件全失败,但 done=4 < MIN_SAMPLES=5,不评估阈值,不抛错
    const errorProducer: ChunkProducer = async () => ({
      kind: 'error', hash: '', size: 0, parserVersion: 1, errorMessage: 'fail',
    });

    await expect(runPipeline(
      {
        entries: [
          { classification: 'NEW_PATH', filePath: 'a.md', newHash: 'h1', sourceMtime: 1, fileSize: 1 },
          { classification: 'NEW_PATH', filePath: 'b.md', newHash: 'h2', sourceMtime: 1, fileSize: 1 },
          { classification: 'NEW_PATH', filePath: 'c.md', newHash: 'h3', sourceMtime: 1, fileSize: 1 },
          { classification: 'NEW_PATH', filePath: 'd.md', newHash: 'h4', sourceMtime: 1, fileSize: 1 },
        ],
        scannedFileCount: 4,
      },
      {
        notebookId: 'nb',
        hashCache: hc, pathMap: pm, bm25,
        producer: errorProducer,
        clock: makeFakeClock(1000),
        eventBus: createEventBus<IndexerEventMap>(),
        alivePathsInNotebook: (h) => pm.alivePathsFor(h),
        pathInScope: () => true,
        persistNotebookState: async () => {},
      }
    )).resolves.not.toThrow();
  });
});
