import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IndexService } from 'src/services/IndexService';
import { SearchService } from 'src/services/SearchService';
import { HashCacheStore } from 'src/indexer/hashCache';
import { PathMapStore } from 'src/indexer/pathMap';
import { BM25Store } from 'src/retrieval/bm25';
import { RerankerRegistry } from 'src/retrieval/rerank';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { InMemoryVaultAdapter } from 'src/adapters/__tests__/InMemoryVaultAdapter';
import { StoragePaths } from 'src/storage/paths';
import { createEventBus } from 'src/infra/eventBus';
import { makeFakeClock } from 'src/infra/clock';
import { ExtractorRegistry } from 'src/extraction/registry';
import { markdownExtractor } from 'src/extraction/markdown';
import { docxExtractor } from 'src/extraction/docx/extractor';
import { pptxExtractor } from 'src/extraction/pptx/extractor';
import { xlsxExtractor } from 'src/extraction/xlsx/extractor';
import { InProcessWorkerHost } from 'src/extraction/worker/InProcessWorkerHost';
import { WorkerHostError } from 'src/extraction/worker/types';
import { LaneScheduler } from 'src/extraction/worker/laneScheduler';
import { SOFT_WARN_BYTES } from 'src/services/officeLimits';
import { computeHash } from 'src/utils/hash';
import { matchesNotebookScope } from 'src/indexer/scope';
import type { Notebook, NotebookOfficeOptions, Source, Chunk } from 'src/types/data';
import type { Extractor } from 'src/extraction/types';
import type { IWorkerHost } from 'src/extraction/worker/types';

const FIXTURES_DIR = join(__dirname, '..', '..', 'extraction', '__tests__', 'fixtures');

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function groupBy<T, K extends string>(arr: T[], keyFn: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of arr) {
    const k = keyFn(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

interface CreateNotebookOptions {
  fileExtensions?: string[];
  officeOptions?: NotebookOfficeOptions;
  sources?: Array<{ type: 'folder'; path: string; recursive: boolean; enabled?: boolean }>;
}

async function buildHarness(opts?: {
  extractorRegistry?: ExtractorRegistry;
  adapter?: InMemoryVaultAdapter;
  workerHost?: IWorkerHost;
}) {
  const vault = opts?.adapter ?? new InMemoryVaultAdapter();
  const dataStore = new InMemoryDataStoreAdapter();
  const paths = new StoragePaths('/p');
  const hc = new HashCacheStore(dataStore, paths);
  const pm = new PathMapStore(dataStore, paths);
  await hc.load(); await pm.load();

  const bm25s = new Map<string, BM25Store>();
  const getBM25 = (id: string) => {
    if (!bm25s.has(id)) bm25s.set(id, new BM25Store(dataStore, paths, id, 1));
    return bm25s.get(id)!;
  };

  let registry: ExtractorRegistry;
  if (opts?.extractorRegistry) {
    registry = opts.extractorRegistry;
  } else {
    registry = new ExtractorRegistry();
    registry.register(['md', 'txt'], async () => markdownExtractor);
    registry.register(['docx'], async () => docxExtractor);
    registry.register(['pptx'], async () => pptxExtractor);
    registry.register(['xlsx'], async () => xlsxExtractor);
    // 预热所有 extractor,让 syncGet 命中
    await registry.get('md');
    await registry.get('docx');
    await registry.get('pptx');
    await registry.get('xlsx');
  }

  const notebookState: Record<string, Notebook> = {
    nb1: {
      id: 'nb1', name: 'e2e',
      sources: [{ id: 's1', type: 'folder', path: 'notes', recursive: true }],
      status: 'idle', createdAt: 1, updatedAt: 1,
    },
  };

  let notebookCounter = 0;

  const resolvedWorkerHost: IWorkerHost = opts?.workerHost
    ?? new InProcessWorkerHost({ registry, hashFn: computeHash });

  const laneScheduler = new LaneScheduler({
    fastConcurrency: 4,
    slowConcurrency: 1,
    softLimits: SOFT_WARN_BYTES,
  });

  const indexService = new IndexService({
    vault, dataStore, paths,
    hashCache: hc, pathMap: pm, getBM25,
    clock: makeFakeClock(1000),
    eventBus: createEventBus(),
    notebookStatePort: {
      getNotebook: async (id) => notebookState[id] ?? null,
      persistState: async (id, patch) => {
        notebookState[id] = { ...notebookState[id], ...(patch as Partial<Notebook>), updatedAt: Date.now() };
      },
    },
    extractorRegistry: registry,
    platform: { isMobile: false },
    workerHost: resolvedWorkerHost,
    laneScheduler,
  });

  const searchService = new SearchService({
    hashCache: hc,
    pathMap: pm,
    getBM25,
    getNotebook: async (id) => notebookState[id] ?? null,
    reindex: (id) => indexService.reindex(id),
    ensureBM25ForNotebook: (id) => indexService.ensureBM25ForNotebook(id),
    rerankers: new RerankerRegistry(),
    resolveRerankerName: () => undefined,
  });

  // ── Harness helpers ──────────────────────────────────────────

  function createNotebook(createOpts?: CreateNotebookOptions): string {
    notebookCounter++;
    const id = `nb-dyn-${notebookCounter}`;
    const sources: Source[] = (createOpts?.sources ?? [{ type: 'folder', path: '/', recursive: true }]).map(
      (s, i) => ({ id: `s-dyn-${notebookCounter}-${i}`, type: s.type, path: s.path, recursive: s.recursive }),
    );
    notebookState[id] = {
      id,
      name: `notebook-${notebookCounter}`,
      sources,
      fileExtensions: createOpts?.fileExtensions,
      officeOptions: createOpts?.officeOptions,
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
    };
    return id;
  }

  function getNotebook(id: string): Notebook {
    const nb = notebookState[id];
    if (!nb) throw new Error(`getNotebook: no notebook with id=${id}`);
    return nb;
  }

  function updateNotebook(id: string, patch: Partial<Pick<Notebook, 'officeOptions' | 'fileExtensions' | 'sources'>>): void {
    const nb = notebookState[id];
    if (!nb) throw new Error(`updateNotebook: no notebook with id=${id}`);
    notebookState[id] = { ...nb, ...patch, updatedAt: Date.now() };
  }

  function getChunks(notebookId: string): Chunk[] {
    const nb = notebookState[notebookId];
    if (!nb) return [];
    return [...hc.aliveEntries()]
      .filter(e => e.status === 'ok')
      .flatMap(e => e.chunks)
      .filter(c => matchesNotebookScope(c.filePath, nb));
  }

  return {
    // Legacy fields used by existing tests
    vault,
    indexService,
    searchService,
    hc,
    pm,
    notebookState,
    // New helper API
    svc: indexService,
    createNotebook,
    getNotebook,
    updateNotebook,
    getChunks,
  };
}

describe('end-to-end indexing + search', () => {
  it('100 files: full index, then incremental mutations land correctly', async () => {
    const { vault, indexService, searchService, pm } = await buildHarness();

    for (let i = 0; i < 100; i++) {
      vault.writeFile(`notes/f${i}.md`, `# F${i}\n\n这是笔记 ${i} 的内容 tag-${i % 5}`);
    }

    await indexService.reindex('nb1');
    const hitsFull = await searchService.search('nb1', 'tag-0', { rerank: false, topK: 50 });
    expect(hitsFull.length).toBeGreaterThan(0);

    // 改 5 个文件
    for (let i = 0; i < 5; i++) {
      vault.writeFile(`notes/f${i}.md`, `# F${i}\n\n更新后的内容 tag-changed`);
    }
    // rename 2 个
    vault.renameFile('notes/f10.md', 'notes/renamed-10.md');
    vault.renameFile('notes/f11.md', 'notes/renamed-11.md');
    // 删 3 个
    vault.deleteFile('notes/f20.md');
    vault.deleteFile('notes/f21.md');
    vault.deleteFile('notes/f22.md');
    // duplicate 2 个(复制已有内容)
    vault.writeFile('notes/dup-30.md', `# F30\n\n这是笔记 30 的内容 tag-0`);
    vault.writeFile('notes/dup-31.md', `# F31\n\n这是笔记 31 的内容 tag-1`);

    await indexService.reindex('nb1');

    // 断言终态
    expect(pm.get('notes/f10.md')).toBeUndefined();
    expect(pm.get('notes/renamed-10.md')).toBeDefined();
    expect(pm.get('notes/f20.md')).toBeUndefined();
    expect(pm.get('notes/dup-30.md')).toBeDefined();

    // 搜索 tag-changed 能命中至少一个改后文件
    const hitsChanged = await searchService.search('nb1', 'tag-changed', { rerank: false, topK: 10 });
    expect(hitsChanged.length).toBeGreaterThan(0);
  }, 30000);

  it('rename preserves BM25 hit count for same content', async () => {
    const { vault, indexService, searchService } = await buildHarness();
    vault.writeFile('notes/only.md', '# Only\n\n唯一标识符 xyzabc');
    await indexService.reindex('nb1');

    const before = await searchService.search('nb1', 'xyzabc', { rerank: false });
    expect(before.length).toBe(1);

    vault.renameFile('notes/only.md', 'notes/moved.md');
    await indexService.reindex('nb1');

    const after = await searchService.search('nb1', 'xyzabc', { rerank: false });
    expect(after.length).toBe(1);
  });

  it('delete removes hit when no duplicate remains', async () => {
    const { vault, indexService, searchService } = await buildHarness();
    vault.writeFile('notes/bye.md', '# Bye\n\n待删除 deleteme');
    await indexService.reindex('nb1');
    expect((await searchService.search('nb1', 'deleteme', { rerank: false })).length).toBe(1);

    vault.deleteFile('notes/bye.md');
    await indexService.reindex('nb1');
    expect((await searchService.search('nb1', 'deleteme', { rerank: false })).length).toBe(0);
  });

  it('duplicate keeps hit count = 1 per unique content (dedupe by fileHash)', async () => {
    const { vault, indexService, searchService } = await buildHarness();
    vault.writeFile('notes/a.md', '# X\n\n独一无二的内容 uniq-xy');
    vault.writeFile('notes/b.md', '# X\n\n独一无二的内容 uniq-xy');
    await indexService.reindex('nb1');

    const hits = await searchService.search('nb1', 'uniq-xy', { rerank: false });
    expect(hits.length).toBe(1);
  });

  it('office 文件 reindex → search 命中 + locator 字段正确', async () => {
    const { vault, indexService, searchService, notebookState, hc: hashCache } = await buildHarness();

    // 添加 office notebook(独立 id,使用相同 vault)
    notebookState['nb-office'] = {
      id: 'nb-office', name: 'office e2e',
      sources: [{ id: 's-office', type: 'folder', path: 'office', recursive: true }],
      fileExtensions: ['md', 'docx', 'pptx', 'xlsx'],
      status: 'idle', createdAt: 1, updatedAt: 1,
    };

    // 向 vault 写入四种格式
    vault.writeFile('office/readme.md', '# 主题\n\n这是 markdown 内容。');
    vault.writeBinary('office/doc.docx', readFixture('simple.docx'));
    vault.writeBinary('office/deck.pptx', readFixture('2-slides.pptx'));
    vault.writeBinary('office/table.xlsx', readFixture('single-sheet.xlsx'));

    await indexService.reindex('nb-office');

    // 从 hashCache 收集所有 chunks(aliveEntries → status=ok → chunks)
    const allChunks = [...hashCache.aliveEntries()]
      .filter(e => e.status === 'ok')
      .flatMap(e => e.chunks);

    const byFile = groupBy(allChunks, c => c.filePath);

    // 四个文件都已索引
    expect(Object.keys(byFile)).toEqual(
      expect.arrayContaining(['office/readme.md', 'office/doc.docx', 'office/deck.pptx', 'office/table.xlsx']),
    );

    // pptx → slide locator
    const pptxChunk = byFile['office/deck.pptx']?.find(c => c.locator?.kind === 'slide');
    expect(pptxChunk).toBeDefined();
    const slideLocator = pptxChunk!.locator!;
    expect(slideLocator.kind === 'slide' && slideLocator.index).toBeGreaterThan(0);

    // xlsx → sheet locator
    const xlsxChunk = byFile['office/table.xlsx']?.find(c => c.locator?.kind === 'sheet');
    expect(xlsxChunk).toBeDefined();

    // md → no locator
    expect(byFile['office/readme.md']?.every(c => !c.locator)).toBe(true);

    // 全文检索跨格式命中
    const hits = await searchService.search('nb-office', '主题', { rerank: false, topK: 20 });
    expect(hits.length).toBeGreaterThan(0);
  }, 30000);

  it('STALE_PARSER: extractor.version 升级 → 同 hash 文件重新提取并更新 cache', async () => {
    // 使用 mutable extractor 让 version / extract 可在测试中段被改写
    const mutableExtractor: Extractor & { version: number; extract: Extractor['extract'] } = {
      extensions: ['md', 'txt'] as const,
      version: 1,
      async extract(bytes) {
        return { markdown: new TextDecoder().decode(bytes), locatorMap: [] };
      },
    };
    const registry = new ExtractorRegistry();
    registry.register(['md', 'txt'], async () => mutableExtractor);
    await registry.get('md'); // 预热 cache,让 syncGet 命中

    const { vault, indexService, hc: hashCache, pm: pathMap, notebookState } = await buildHarness({ extractorRegistry: registry });
    const notebook = notebookState['nb1'];

    vault.writeFile('notes/a.md', '# A\n\n初始内容');
    await indexService.reindex('nb1');

    const hash1 = pathMap.get('notes/a.md')!.fileHash;
    const oldEntry = hashCache.get(hash1)!;
    const oldParserVersion = oldEntry.parserVersion;
    expect(oldEntry.chunks.length).toBeGreaterThan(0);
    expect(oldEntry.chunks.every(c => !c.content.includes('附加内容'))).toBe(true);

    // 模拟 extractor 升级:直接改 version + extract 实现
    (mutableExtractor as { version: number }).version = 999;
    mutableExtractor.extract = async (bytes) => ({
      markdown: new TextDecoder().decode(bytes) + '\n\n附加内容',
      locatorMap: [],
    });

    await indexService.reindex('nb1');

    const hash2 = pathMap.get('notes/a.md')!.fileHash;
    expect(hash2).toBe(hash1); // 文件字节没变,hash 不变
    const newEntry = hashCache.get(hash2)!;
    expect(newEntry.parserVersion).not.toBe(oldParserVersion);
    expect(newEntry.chunks.some(c => c.content.includes('附加内容'))).toBe(true);
  });

  it('worker 第一次 timeout → transient 错误记录;第二次 reindex 成功', async () => {
    const vaultAdapter = new InMemoryVaultAdapter();
    vaultAdapter.writeBinary('docs/doc.docx', readFixture('simple.docx'));

    // Build an inner InProcessWorkerHost to delegate to after the first call
    const innerRegistry = new ExtractorRegistry();
    innerRegistry.register(['docx'], async () => docxExtractor);
    await innerRegistry.get('docx');
    const innerInProcessHost = new InProcessWorkerHost({ registry: innerRegistry, hashFn: computeHash });

    let callCount = 0;
    const stubHost: IWorkerHost = {
      async extract(req, signal) {
        callCount++;
        if (callCount === 1) throw new WorkerHostError('extraction timeout', 'timeout');
        return innerInProcessHost.extract(req, signal);
      },
      async shutdown() {},
    };

    const harness = await buildHarness({ adapter: vaultAdapter, workerHost: stubHost });
    const notebookId = harness.createNotebook({
      fileExtensions: ['docx'],
      sources: [{ type: 'folder', path: 'docs', recursive: true }],
    });

    // 第一次 reindex — transient 错误,no chunks
    await harness.svc.reindex(notebookId);
    const nbAfterFirst = harness.getNotebook(notebookId);
    expect(nbAfterFirst.transientFileErrors).toBeDefined();
    expect(nbAfterFirst.transientFileErrors!.length).toBeGreaterThan(0);
    expect(harness.getChunks(notebookId).length).toBe(0);
    expect(callCount).toBe(1);

    // 第二次 reindex — stub 放行,应成功
    await harness.svc.reindex(notebookId);
    expect(harness.getChunks(notebookId).length).toBeGreaterThan(0);
    const nbAfterSecond = harness.getNotebook(notebookId);
    // 成功后 transientFileErrors 应被清空(pipeline 以空数组或 undefined 写回)
    expect(!nbAfterSecond.transientFileErrors || nbAfterSecond.transientFileErrors.length === 0).toBe(true);
  }, 30000);

  it('officeOptions.includePptxNotes 翻转 → 仅 pptx 文件 STALE_PARSER 重建', async () => {
    const vaultAdapter = new InMemoryVaultAdapter();
    vaultAdapter.writeBinary('slides/with-notes.pptx', readFixture('with-notes.pptx'));
    vaultAdapter.writeBinary('slides/table.xlsx', readFixture('single-sheet.xlsx'));

    const harness = await buildHarness({ adapter: vaultAdapter });
    const notebookId = harness.createNotebook({
      fileExtensions: ['pptx', 'xlsx'],
      officeOptions: { includePptxNotes: false },
      sources: [{ type: 'folder', path: 'slides', recursive: true }],
    });

    // 第一次 reindex(备注关闭)
    await harness.svc.reindex(notebookId);
    const baselineChunks = harness.getChunks(notebookId);
    expect(baselineChunks.length).toBeGreaterThan(0);
    expect(baselineChunks.some(c => c.content.includes('备注内容'))).toBe(false);

    // 翻转 includePptxNotes
    harness.updateNotebook(notebookId, { officeOptions: { includePptxNotes: true } });

    // 第二次 reindex(备注开启)
    await harness.svc.reindex(notebookId);
    const newChunks = harness.getChunks(notebookId);
    expect(newChunks.some(c => c.content.includes('备注内容'))).toBe(true);

    // xlsx 无 opts 影响 → parserVersion 不变 → 内容应与第一次一致
    const baselineXlsx = baselineChunks.filter(c => c.filePath === 'slides/table.xlsx');
    const newXlsx = newChunks.filter(c => c.filePath === 'slides/table.xlsx');
    expect(newXlsx.length).toBeGreaterThan(0);
    expect(newXlsx.map(c => c.content)).toEqual(baselineXlsx.map(c => c.content));
  }, 30000);
});
