import { describe, it, expect } from 'vitest';
import { IndexService } from 'src/services/IndexService';
import { HashCacheStore } from 'src/indexer/hashCache';
import { PathMapStore } from 'src/indexer/pathMap';
import { BM25Store } from 'src/retrieval/bm25';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { InMemoryVaultAdapter } from 'src/adapters/__tests__/InMemoryVaultAdapter';
import { StoragePaths } from 'src/storage/paths';
import { createEventBus } from 'src/infra/eventBus';
import { makeFakeClock } from 'src/infra/clock';
import { ExtractorRegistry } from 'src/extraction/registry';
import { markdownExtractor } from 'src/extraction/markdown';
import { computeParserVersion } from 'src/chunking/types';
import { InProcessWorkerHost } from 'src/extraction/worker/InProcessWorkerHost';
import { LaneScheduler } from 'src/extraction/worker/laneScheduler';
import { WorkerHostError } from 'src/extraction/worker/types';
import { SOFT_WARN_BYTES } from 'src/services/officeLimits';
import { computeHash } from 'src/utils/hash';
import type { IWorkerHost } from 'src/extraction/worker/types';
import type { Notebook } from 'src/types/data';
import type { IndexerEventMap } from 'src/indexer/events';

function makeWorkerDeps(registry: ExtractorRegistry) {
  const workerHost = new InProcessWorkerHost({ registry, hashFn: computeHash });
  const laneScheduler = new LaneScheduler({
    fastConcurrency: 4,
    slowConcurrency: 1,
    softLimits: SOFT_WARN_BYTES,
  });
  return { workerHost, laneScheduler };
}

const notebook: Notebook = {
  id: 'nb1', name: 'test',
  sources: [{ id: 's1', type: 'folder', path: 'notes', recursive: true }],
  status: 'idle', createdAt: 1, updatedAt: 1,
};

async function makeRegistry(): Promise<ExtractorRegistry> {
  const registry = new ExtractorRegistry();
  registry.register(['md', 'txt'], async () => markdownExtractor);
  await registry.get('md'); // 预热,让 syncGet 命中
  return registry;
}

describe('IndexService', () => {
  it('reindex indexes all markdown under source path', async () => {
    const vault = new InMemoryVaultAdapter();
    vault.writeFile('notes/a.md', '# A\n\n内容 a');
    vault.writeFile('notes/b.md', '# B\n\n内容 b');
    vault.writeFile('other/c.md', '# C\n\n内容 c');

    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    const bm25Registry = new Map<string, BM25Store>();
    const getBM25 = (id: string) => {
      if (!bm25Registry.has(id)) bm25Registry.set(id, new BM25Store(adapter, paths, id, 1));
      return bm25Registry.get(id)!;
    };

    const registry = await makeRegistry();
    const stateSink: Record<string, any> = {};
    const service = new IndexService({
      vault,
      dataStore: adapter,
      paths,
      hashCache: hc,
      pathMap: pm,
      getBM25,
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async () => notebook,
        persistState: async (id, patch) => { stateSink[id] = { ...(stateSink[id] ?? {}), ...patch }; },
      },
      extractorRegistry: registry,
      platform: { isMobile: false },
      ...makeWorkerDeps(registry),
    });

    await service.reindex('nb1');

    expect(pm.get('notes/a.md')).toBeDefined();
    expect(pm.get('notes/b.md')).toBeDefined();
    expect(pm.get('other/c.md')).toBeUndefined();
    expect(stateSink.nb1.status).toBe('idle');
    expect(stateSink.nb1.stats.fileCount).toBe(2);
  });

  it('incremental reindex: unchanged files are UNCHANGED', async () => {
    const vault = new InMemoryVaultAdapter();
    vault.writeFile('notes/a.md', 'content', 100);

    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    const getBM25 = (id: string) => new BM25Store(adapter, paths, id, 1);

    const registry2 = await makeRegistry();
    const service = new IndexService({
      vault, dataStore: adapter, paths, hashCache: hc, pathMap: pm, getBM25,
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async () => notebook,
        persistState: async () => {},
      },
      extractorRegistry: registry2,
      platform: { isMobile: false },
      ...makeWorkerDeps(registry2),
    });

    await service.reindex('nb1');
    const firstHash = pm.get('notes/a.md')?.fileHash;

    await service.reindex('nb1');
    expect(pm.get('notes/a.md')?.fileHash).toBe(firstHash);
  });

  it('markDirty updates notebook status via port', async () => {
    const vault = new InMemoryVaultAdapter();
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const stateSink: Record<string, any> = {};
    const markDirtyRegistry = await makeRegistry();
    const service = new IndexService({
      vault, dataStore: adapter, paths, hashCache: hc, pathMap: pm,
      getBM25: (id) => new BM25Store(adapter, paths, id, 1),
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async () => notebook,
        persistState: async (id, patch) => { stateSink[id] = { ...(stateSink[id] ?? {}), ...patch }; },
      },
      extractorRegistry: markDirtyRegistry,
      platform: { isMobile: false },
      ...makeWorkerDeps(markDirtyRegistry),
    });

    await service.markDirty('nb1');
    expect(stateSink.nb1.status).toBe('dirty');
  });

  it('concurrent reindex of same notebook is serialised', async () => {
    const vault = new InMemoryVaultAdapter();
    vault.writeFile('notes/a.md', 'x');
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const concurrRegistry = await makeRegistry();
    const service = new IndexService({
      vault, dataStore: adapter, paths, hashCache: hc, pathMap: pm,
      getBM25: (id) => new BM25Store(adapter, paths, id, 1),
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async () => notebook,
        persistState: async () => {},
      },
      extractorRegistry: concurrRegistry,
      platform: { isMobile: false },
      ...makeWorkerDeps(concurrRegistry),
    });

    const r1 = service.reindex('nb1');
    const r2 = service.reindex('nb1');
    await Promise.all([r1, r2]);
    expect(pm.get('notes/a.md')).toBeDefined();
  });

  it('reindex does NOT run compaction (spec §3.1.6: compaction is decoupled)', async () => {
    const vault = new InMemoryVaultAdapter();
    vault.writeFile('notes/a.md', 'x');
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    const compactRegistry = await makeRegistry();
    const service = new IndexService({
      vault, dataStore: adapter, paths, hashCache: hc, pathMap: pm,
      getBM25: (id) => new BM25Store(adapter, paths, id, 1),
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async () => notebook,
        persistState: async () => {},
      },
      extractorRegistry: compactRegistry,
      platform: { isMobile: false },
      ...makeWorkerDeps(compactRegistry),
    });

    await service.reindex('nb1');
    expect(await adapter.exists(paths.compactMeta)).toBe(false);
  });

  it('**H3 version invalidation**: stale chunks are rejected; reindex produces fresh ones with current chunkingVersion', async () => {
    const vault = new InMemoryVaultAdapter();
    vault.writeFile('notes/a.md', '# A\n\n内容 a', 100);

    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const bm25Cache = new Map<string, BM25Store>();
    const getBM25 = (id: string) => {
      if (!bm25Cache.has(id)) bm25Cache.set(id, new BM25Store(adapter, paths, id, 1));
      return bm25Cache.get(id)!;
    };

    const stateSink: Record<string, any> = {
      nb1: { ...notebook, lastIndexVersion: 0 },
    };
    const h3Registry = await makeRegistry();
    const service = new IndexService({
      vault, dataStore: adapter, paths, hashCache: hc, pathMap: pm, getBM25,
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async (id) => stateSink[id] ?? null,
        persistState: async (id, patch) => { stateSink[id] = { ...stateSink[id], ...patch }; },
      },
      extractorRegistry: h3Registry,
      platform: { isMobile: false },
      ...makeWorkerDeps(h3Registry),
    });

    await service.reindex('nb1');
    const hashAfterFirst = pm.get('notes/a.md')?.fileHash;
    expect(hashAfterFirst).toBeDefined();

    const staleEntry = hc.get(hashAfterFirst!)!;
    await hc.append({ ...staleEntry, chunkingVersion: 0, parserVersion: 0, indexedAt: 2 });
    stateSink.nb1.lastIndexVersion = 0;

    await service.reindex('nb1');

    expect(stateSink.nb1.lastIndexVersion).toBe(1);
    const currentHash = pm.get('notes/a.md')?.fileHash;
    expect(currentHash).toBeDefined();
    const rechunked = hc.get(currentHash!)!;
    expect(rechunked.chunkingVersion).toBe(1);
    const expectedPV = computeParserVersion(markdownExtractor.version, '');
    expect(rechunked.parserVersion).toBe(expectedPV);
    expect(rechunked.status).toBe('ok');
    expect(rechunked.chunks.length).toBeGreaterThan(0);
  });

  it('**H3 version invalidation for legacy (undefined lastIndexVersion)**: also triggers rechunk', async () => {
    const vault = new InMemoryVaultAdapter();
    vault.writeFile('notes/a.md', '# A\n\n内容 a', 100);

    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const bm25Cache = new Map<string, BM25Store>();
    const getBM25 = (id: string) => {
      if (!bm25Cache.has(id)) bm25Cache.set(id, new BM25Store(adapter, paths, id, 1));
      return bm25Cache.get(id)!;
    };

    const stateSink: Record<string, any> = { nb1: { ...notebook } };
    const legacyRegistry = await makeRegistry();
    const service = new IndexService({
      vault, dataStore: adapter, paths, hashCache: hc, pathMap: pm, getBM25,
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async (id) => stateSink[id] ?? null,
        persistState: async (id, patch) => { stateSink[id] = { ...stateSink[id], ...patch }; },
      },
      extractorRegistry: legacyRegistry,
      platform: { isMobile: false },
      ...makeWorkerDeps(legacyRegistry),
    });

    await service.reindex('nb1');
    const hashAfterFirst = pm.get('notes/a.md')?.fileHash!;

    await hc.append({ ...hc.get(hashAfterFirst)!, chunkingVersion: 0, parserVersion: 0, indexedAt: 2 });
    delete stateSink.nb1.lastIndexVersion;

    await service.reindex('nb1');
    expect(stateSink.nb1.lastIndexVersion).toBe(1);
    const refreshed = hc.get(pm.get('notes/a.md')?.fileHash!)!;
    expect(refreshed.chunkingVersion).toBe(1);
  });

  it('ensureBM25ForNotebook rebuilds BM25 from HashCache when load fails', async () => {
    const vault = new InMemoryVaultAdapter();
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    // computeParserVersion(markdownExtractor.version=1, optsKey='') with PARSER_VERSION=2
    // seed = "2|1|" -> FNV-1a 32bit -> must match what service computes
    // We pre-warm the registry, then read back the expected parserVersion
    const registry = await makeRegistry();
    const { computeParserVersion } = await import('src/chunking/types');
    const expectedParserVersion = computeParserVersion(markdownExtractor.version, '');

    await hc.append({
      fileHash: 'hA', fileSize: 1,
      chunks: [{
        id: 'hA:0', chunkIndex: 0, fileHash: 'hA', filePath: 'notes/a.md', sourceId: 's1',
        headingText: '', headingPath: [],
        content: '机器学习内容', contentHash: 'ch', tokenCount: 3,
        charStart: 0, charEnd: 5, kind: 'paragraph',
      }],
      chunkingVersion: 1, parserVersion: expectedParserVersion, indexedAt: 1, status: 'ok',
    });
    await pm.append({ filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 });

    const bm25Cache = new Map<string, BM25Store>();
    const getBM25 = (id: string) => {
      if (!bm25Cache.has(id)) bm25Cache.set(id, new BM25Store(adapter, paths, id, 1));
      return bm25Cache.get(id)!;
    };

    const service = new IndexService({
      vault, dataStore: adapter, paths, hashCache: hc, pathMap: pm, getBM25,
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async () => notebook,
        persistState: async () => {},
      },
      extractorRegistry: registry,
      platform: { isMobile: false },
      ...makeWorkerDeps(registry),
    });

    await service.ensureBM25ForNotebook('nb1');
    const hits = getBM25('nb1').search('机器学习');
    expect(hits.map(h => h.id)).toContain('hA:0');
  });

  it('docx 超 30MB 在 scan 阶段被跳过(不进 producer,不记 transient)', async () => {
    const vault = new InMemoryVaultAdapter();
    vault.writeBinary('notes/big.docx', new Uint8Array(64));
    vault.setStat('notes/big.docx', { size: 35 * 1024 * 1024, mtime: Date.now() });

    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const docxNotebook: Notebook = {
      id: 'nb1', name: 'docx-test',
      sources: [{ id: 's1', type: 'folder', path: 'notes', recursive: true }],
      fileExtensions: ['docx'],
      status: 'idle', createdAt: 1, updatedAt: 1,
    };

    const stateSink: Record<string, any> = {};
    const docxRegistry = await makeRegistry();
    const service = new IndexService({
      vault, dataStore: adapter, paths, hashCache: hc, pathMap: pm,
      getBM25: (id) => new BM25Store(adapter, paths, id, 1),
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async () => docxNotebook,
        persistState: async (id, patch) => { stateSink[id] = { ...(stateSink[id] ?? {}), ...patch }; },
      },
      extractorRegistry: docxRegistry,
      platform: { isMobile: false },
      ...makeWorkerDeps(docxRegistry),
    });

    await service.reindex('nb1');

    // 文件不应进入 pathMap（没被处理）
    expect(pm.get('notes/big.docx')).toBeUndefined();
    // transientFileErrors 不应包含该文件
    const transientErrors: Array<{ path: string }> = stateSink.nb1?.transientFileErrors ?? [];
    expect(transientErrors.some(e => e.path === 'notes/big.docx')).toBe(false);
  });

  it('worker timeout 在 producer → kind:transient,不写 HashCache', async () => {
    const vault = new InMemoryVaultAdapter();
    vault.writeFile('notes/a.md', '# Test\n\ntransient content', 100);

    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    const timeoutNotebook: Notebook = {
      id: 'nb1', name: 'transient-test',
      sources: [{ id: 's1', type: 'folder', path: 'notes', recursive: true }],
      status: 'idle', createdAt: 1, updatedAt: 1,
    };

    // stub workerHost that always throws timeout
    const stubHost: IWorkerHost = {
      async extract() { throw new WorkerHostError('extraction timeout', 'timeout'); },
      async shutdown() {},
    };

    const timeoutRegistry = await makeRegistry();
    const stateSink: Record<string, any> = {};
    const service = new IndexService({
      vault, dataStore: adapter, paths, hashCache: hc, pathMap: pm,
      getBM25: (id) => new BM25Store(adapter, paths, id, 1),
      clock: makeFakeClock(1000),
      eventBus: createEventBus<IndexerEventMap>(),
      notebookStatePort: {
        getNotebook: async () => timeoutNotebook,
        persistState: async (id, patch) => { stateSink[id] = { ...(stateSink[id] ?? {}), ...patch }; },
      },
      extractorRegistry: timeoutRegistry,
      platform: { isMobile: false },
      workerHost: stubHost,
      laneScheduler: new LaneScheduler({ fastConcurrency: 4, slowConcurrency: 1, softLimits: SOFT_WARN_BYTES }),
    });

    await service.reindex('nb1');

    // file should NOT be in pathMap (transient means not committed to cache)
    expect(pm.get('notes/a.md')).toBeUndefined();
    // transientFileErrors should contain at least one entry
    const transientErrs: Array<{ path: string }> = stateSink.nb1?.transientFileErrors ?? [];
    expect(transientErrs.length).toBeGreaterThan(0);
    expect(transientErrs.some(e => e.path === 'notes/a.md')).toBe(true);
  });
});
