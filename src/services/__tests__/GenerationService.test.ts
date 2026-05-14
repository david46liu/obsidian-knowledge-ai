import { describe, it, expect, vi } from 'vitest';
import { GenerationService, type ResolvedTaskClient } from 'src/services/GenerationService';
import type { HashCacheStore } from 'src/indexer/hashCache';
import type { PathMapStore } from 'src/indexer/pathMap';
import { makeFakeClock } from 'src/infra/clock';
import type { Chunk, Notebook, HashCacheEntry, PathMapEntry } from 'src/types/data';
import type { GenerationStreamEvent } from 'src/types/artifact';
import type {
  ChatMessage,
  ChatOptions,
  LLMClient,
  ProviderCapabilities,
  StreamEvent,
} from 'src/providers/types';
import { CHUNKING_VERSION, PARSER_VERSION } from 'src/chunking/types';

const CAPS: ProviderCapabilities = {
  supportsJsonMode: false,
  supportsStreaming: true,
  supportsTools: false,
  supportsTemperature: true,
  supportsMaxTokens: true,
  maxTokensFieldName: 'max_tokens',
  supportsEmbeddings: false,
  supportsVision: false,
};

function mkChunk(id: string, content: string, opts: Partial<Chunk> = {}): Chunk {
  return {
    id,
    chunkIndex: 0,
    fileHash: 'h',
    filePath: 'notes/a.md',
    sourceId: 's',
    headingText: '',
    headingPath: [],
    content,
    contentHash: 'c',
    tokenCount: content.length,
    charStart: 0,
    charEnd: content.length,
    kind: 'paragraph',
    ...opts,
  };
}

function mkNotebook(id: string, sourcePath = 'notes'): Notebook {
  return {
    id,
    name: 'NB',
    sources: [{ id: 's', type: 'folder', path: sourcePath, recursive: true }],
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
  };
}

function mkPathMapStub(entries: PathMapEntry[]): PathMapStore {
  return {
    allAliveEntries: function* () {
      yield* entries;
    },
  } as unknown as PathMapStore;
}

function mkHashCacheStub(map: Map<string, HashCacheEntry>): HashCacheStore {
  return {
    get: (hash: string) => map.get(hash),
  } as unknown as HashCacheStore;
}

function mkOkEntry(fileHash: string, chunks: Chunk[]): HashCacheEntry {
  return {
    fileHash,
    fileSize: 100,
    chunks,
    chunkingVersion: CHUNKING_VERSION,
    parserVersion: PARSER_VERSION,
    indexedAt: 1,
    status: 'ok',
  };
}

interface FakeStreamScript {
  deltas?: string[];
  throw?: Error;
}

function makeFakeLLM(script: FakeStreamScript = {}): {
  client: LLMClient;
  capturedMessages: ChatMessage[][];
} {
  const captured: ChatMessage[][] = [];
  const client: LLMClient = {
    capabilities: CAPS,
    async chat() {
      return { content: '' };
    },
    chatStream(opts: ChatOptions): AsyncIterable<StreamEvent> {
      captured.push(opts.messages);
      return (async function* () {
        if (script.throw) throw script.throw;
        for (const d of script.deltas ?? []) {
          yield { type: 'delta', content: d };
        }
        yield { type: 'done' };
      })();
    },
  };
  return { client, capturedMessages: captured };
}

async function collect(iter: AsyncIterable<GenerationStreamEvent>): Promise<GenerationStreamEvent[]> {
  const out: GenerationStreamEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('GenerationService', () => {
  it('emits retrieving → citations → generating → token×N → done in order', async () => {
    const chunks = [mkChunk('hA:0', 'alpha content', { fileHash: 'hA' })];
    const pathMap = mkPathMapStub([
      { filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map([['hA', mkOkEntry('hA', chunks)]]));
    const { client } = makeFakeLLM({ deltas: ['Hel', 'lo'] });
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm-1' }),
      clock: makeFakeClock(1000),
    });
    const events = await collect(svc.generate('nb1', 'summary'));
    const types = events.map(e => e.type);
    expect(types[0]).toBe('retrieving');
    expect(types).toContain('citations');
    expect(types).toContain('generating');
    expect(types.filter(t => t === 'token')).toHaveLength(2);
    expect(types[types.length - 1]).toBe('done');
    const done = events.find(e => e.type === 'done');
    if (done && done.type === 'done') {
      expect(done.artifact.content).toBe('Hello');
      expect(done.artifact.kind).toBe('summary');
      expect(done.artifact.modelUsed).toBe('m-1');
      expect(done.artifact.notebookId).toBe('nb1');
      expect(done.artifact.generatedAt).toBe(1000);
      expect(done.artifact.title).toBe('核心摘要');
      expect(done.artifact.truncated).toBeUndefined();
    }
  });

  it('emits error when notebook not found', async () => {
    const { client } = makeFakeLLM({ deltas: ['x'] });
    const svc = new GenerationService({
      hashCache: mkHashCacheStub(new Map()),
      pathMap: mkPathMapStub([]),
      getNotebook: async () => null,
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.generate('nb-missing', 'summary'));
    const errs = events.filter(e => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].type === 'error' && errs[0].error).toMatch(/notebook not found/);
    expect(events.some(e => e.type === 'done')).toBe(false);
  });

  it('emits error when chunks=0', async () => {
    const { client } = makeFakeLLM({ deltas: ['x'] });
    const svc = new GenerationService({
      hashCache: mkHashCacheStub(new Map()),
      pathMap: mkPathMapStub([]),
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.generate('nb1', 'summary'));
    const errs = events.filter(e => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].type === 'error' && errs[0].error).toMatch(/为空或未索引/);
    expect(events.some(e => e.type === 'done')).toBe(false);
  });

  it('emits error when resolveTaskClient returns null', async () => {
    const chunks = [mkChunk('hA:0', 'alpha', { fileHash: 'hA' })];
    const pathMap = mkPathMapStub([
      { filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map([['hA', mkOkEntry('hA', chunks)]]));
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: () => null,
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.generate('nb1', 'summary'));
    const errs = events.filter(e => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].type === 'error' && errs[0].error).toMatch(/未配置/);
    expect(events.some(e => e.type === 'done')).toBe(false);
  });

  it('emits error when chatStream throws', async () => {
    const chunks = [mkChunk('hA:0', 'alpha', { fileHash: 'hA' })];
    const pathMap = mkPathMapStub([
      { filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map([['hA', mkOkEntry('hA', chunks)]]));
    const { client } = makeFakeLLM({ throw: new Error('llm-blew-up') });
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setLevel: vi.fn() },
    });
    const events = await collect(svc.generate('nb1', 'summary'));
    const errs = events.filter(e => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].type === 'error' && errs[0].error).toBe('llm-blew-up');
    expect(events.some(e => e.type === 'done')).toBe(false);
  });

  it('emits error "已取消" and no done when signal aborted mid-stream', async () => {
    const chunks = [mkChunk('hA:0', 'alpha', { fileHash: 'hA' })];
    const pathMap = mkPathMapStub([
      { filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map([['hA', mkOkEntry('hA', chunks)]]));
    const ctrl = new AbortController();
    const client: LLMClient = {
      capabilities: CAPS,
      async chat() { return { content: '' }; },
      chatStream(): AsyncIterable<StreamEvent> {
        return (async function* () {
          yield { type: 'delta', content: 'first' };
          ctrl.abort();
          yield { type: 'delta', content: 'should-be-ignored' };
        })();
      },
    };
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.generate('nb1', 'summary', { signal: ctrl.signal }));
    expect(events.some(e => e.type === 'done')).toBe(false);
    const errs = events.filter(e => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].type === 'error' && errs[0].error).toBe('已取消');
    // 第一个 token 应该被记录
    const tokens = events.filter(e => e.type === 'token');
    expect(tokens).toHaveLength(1);
  });

  it('collectNotebookChunks dedupes by chunk.id and sorts by filePath then chunkIndex', async () => {
    // 构造跨文件的 chunks,刻意打乱顺序 + 故意制造 id 重复(不会发生但要测去重)
    const chunksA = [
      mkChunk('hA:1', 'a-one', { fileHash: 'hA', filePath: 'notes/a.md', chunkIndex: 1 }),
      mkChunk('hA:0', 'a-zero', { fileHash: 'hA', filePath: 'notes/a.md', chunkIndex: 0 }),
    ];
    const chunksB = [
      mkChunk('hB:0', 'b-zero', { fileHash: 'hB', filePath: 'notes/b.md', chunkIndex: 0 }),
    ];
    // 故意让两个 PathMapEntry 指向相同 fileHash hA(模拟 dedup):
    // 同一 hash 被 hashCache.get 返回同样的 entry,chunk id 重复 → 应去重一次
    const pathMap = mkPathMapStub([
      { filePath: 'notes/b.md', fileHash: 'hB', sourceMtime: 1, observedAt: 1 },
      { filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 },
      { filePath: 'notes/a-dup.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map([
      ['hA', mkOkEntry('hA', chunksA)],
      ['hB', mkOkEntry('hB', chunksB)],
    ]));
    const { client, capturedMessages } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.generate('nb1', 'summary'));
    const cit = events.find(e => e.type === 'citations');
    if (cit && cit.type === 'citations') {
      // 3 个 chunk(去重后):a-zero, a-one, b-zero
      expect(cit.citations).toHaveLength(3);
      expect(cit.citations.map(c => c.chunkId)).toEqual(['hA:0', 'hA:1', 'hB:0']);
      expect(cit.citations.map(c => c.index)).toEqual([1, 2, 3]);
    }
    // system 资料块也按 [1] [2] [3] 顺序拼接
    const sysContent = capturedMessages[0][0].content as string;
    const idx1 = sysContent.indexOf('a-zero');
    const idx2 = sysContent.indexOf('a-one');
    const idx3 = sysContent.indexOf('b-zero');
    expect(idx1).toBeGreaterThan(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  it('collectNotebookChunks skips entries with status!=ok or version mismatch', async () => {
    const okChunks = [mkChunk('hOK:0', 'good', { fileHash: 'hOK', filePath: 'notes/ok.md' })];
    const skippedChunks = [mkChunk('hSK:0', 'skipped', { fileHash: 'hSK', filePath: 'notes/sk.md' })];
    const errChunks = [mkChunk('hER:0', 'errored', { fileHash: 'hER', filePath: 'notes/er.md' })];
    const oldVerChunks = [mkChunk('hOV:0', 'old-ver', { fileHash: 'hOV', filePath: 'notes/ov.md' })];

    const pathMap = mkPathMapStub([
      { filePath: 'notes/ok.md', fileHash: 'hOK', sourceMtime: 1, observedAt: 1 },
      { filePath: 'notes/sk.md', fileHash: 'hSK', sourceMtime: 1, observedAt: 1 },
      { filePath: 'notes/er.md', fileHash: 'hER', sourceMtime: 1, observedAt: 1 },
      { filePath: 'notes/ov.md', fileHash: 'hOV', sourceMtime: 1, observedAt: 1 },
      // 不存在 hash entry 的 path 应该也跳过
      { filePath: 'notes/missing.md', fileHash: 'hMissing', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map<string, HashCacheEntry>([
      ['hOK', mkOkEntry('hOK', okChunks)],
      ['hSK', { ...mkOkEntry('hSK', skippedChunks), status: 'skipped' }],
      ['hER', { ...mkOkEntry('hER', errChunks), status: 'error', errorMessage: 'parse failed' }],
      ['hOV', { ...mkOkEntry('hOV', oldVerChunks), chunkingVersion: CHUNKING_VERSION + 99 }],
    ]));
    const { client } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.generate('nb1', 'summary'));
    const cit = events.find(e => e.type === 'citations');
    expect(cit && cit.type === 'citations').toBe(true);
    if (cit && cit.type === 'citations') {
      expect(cit.citations).toHaveLength(1);
      expect(cit.citations[0].chunkId).toBe('hOK:0');
    }
  });

  it('buildCitationsAndBudget truncates when total tokens exceed MAX_GENERATION_TOKENS', async () => {
    // 第一个 chunk 小,第二个超大(超 200K),应在 i=1 break,truncated=true
    const big = mkChunk('hB:0', 'big', { fileHash: 'hB', filePath: 'notes/b.md', tokenCount: 300_000 });
    const small1 = mkChunk('hA:0', 'small one', { fileHash: 'hA', filePath: 'notes/a.md', tokenCount: 10 });
    const small3 = mkChunk('hC:0', 'should-be-dropped', { fileHash: 'hC', filePath: 'notes/c.md', tokenCount: 10 });
    const pathMap = mkPathMapStub([
      { filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 },
      { filePath: 'notes/b.md', fileHash: 'hB', sourceMtime: 1, observedAt: 1 },
      { filePath: 'notes/c.md', fileHash: 'hC', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map([
      ['hA', mkOkEntry('hA', [small1])],
      ['hB', mkOkEntry('hB', [big])],
      ['hC', mkOkEntry('hC', [small3])],
    ]));
    const { client, capturedMessages } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.generate('nb1', 'summary'));
    const cit = events.find(e => e.type === 'citations');
    if (cit && cit.type === 'citations') {
      expect(cit.truncated).toBe(true);
      // includedChunks 仅含第一个(small1);第二个 big 触发 break,第三个 small3 也被截断
      expect(cit.citations).toHaveLength(1);
      expect(cit.citations[0].chunkId).toBe('hA:0');
    }
    // 资料块只含 small one,不含 big / dropped
    const sysContent = capturedMessages[0][0].content;
    expect(sysContent).toContain('small one');
    expect(sysContent).not.toContain('big');
    expect(sysContent).not.toContain('should-be-dropped');
    // done 中 artifact.truncated=true
    const done = events.find(e => e.type === 'done');
    if (done && done.type === 'done') {
      expect(done.artifact.truncated).toBe(true);
    }
  });

  it('buildMessages composes system block with [N] heading path filePath content blank-line', async () => {
    const chunks = [
      mkChunk('hA:0', 'first body', {
        fileHash: 'hA',
        filePath: 'notes/a.md',
        chunkIndex: 0,
        headingPath: ['Topic A', 'Sub'],
      }),
      mkChunk('hB:0', 'second body', {
        fileHash: 'hB',
        filePath: 'notes/b.md',
        chunkIndex: 0,
        headingPath: [],
      }),
    ];
    const pathMap = mkPathMapStub([
      { filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 },
      { filePath: 'notes/b.md', fileHash: 'hB', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map([
      ['hA', mkOkEntry('hA', [chunks[0]])],
      ['hB', mkOkEntry('hB', [chunks[1]])],
    ]));
    const { client, capturedMessages } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
    });
    await collect(svc.generate('nb1', 'study-guide'));
    const msgs = capturedMessages[0];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: '请基于上述资料生成。' });
    const sys = msgs[0].content;
    // 包含 generator 的 systemPrompt(study-guide)
    expect(sys).toContain('学习指南生成器');
    // 包含资料标头
    expect(sys).toContain('== 资料 ==');
    // [1] 行格式: [1] Topic A > Sub — notes/a.md
    expect(sys).toContain('[1] Topic A > Sub — notes/a.md');
    expect(sys).toContain('first body');
    // [2] 无 heading 用占位
    expect(sys).toContain('[2] (无标题) — notes/b.md');
    expect(sys).toContain('second body');
  });

  it('collectNotebookChunks accepts chunks with composite parserVersion (FNV hash, not constant)', async () => {
    // 回归测试：IndexService.ensureBM25ForNotebook 写入 computeParserVersion(extractor.version, optsKey)
    // 结果是 32 位 FNV hash(如 50840246),而非旧常量 PARSER_VERSION=2。
    // GenerationService 不再比较 parserVersion — 只验证 chunkingVersion — 所以 FNV hash 值应当被接受。
    const FNV_HASH_PARSER_VERSION = 50840246; // 典型的 md 文件 FNV hash
    const chunks = [mkChunk('hFNV:0', 'fnv content', { fileHash: 'hFNV', filePath: 'notes/fnv.md' })];
    const pathMap = mkPathMapStub([
      { filePath: 'notes/fnv.md', fileHash: 'hFNV', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map([
      ['hFNV', {
        fileHash: 'hFNV',
        fileSize: 100,
        chunks,
        chunkingVersion: CHUNKING_VERSION,
        parserVersion: FNV_HASH_PARSER_VERSION, // 复合 FNV hash,不是 PARSER_VERSION 常量
        indexedAt: 1,
        status: 'ok' as const,
      }],
    ]));
    const { client } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.generate('nb1', 'summary'));
    // 应该成功找到 chunks,不应该发出 "为空或未索引" 错误
    expect(events.some(e => e.type === 'error')).toBe(false);
    const cit = events.find(e => e.type === 'citations');
    expect(cit && cit.type === 'citations').toBe(true);
    if (cit && cit.type === 'citations') {
      expect(cit.citations).toHaveLength(1);
      expect(cit.citations[0].chunkId).toBe('hFNV:0');
    }
    expect(events.find(e => e.type === 'done')).toBeDefined();
  });

  it('uses opts.title when provided; falls back to defaultTitle otherwise', async () => {
    const chunks = [mkChunk('hA:0', 'x', { fileHash: 'hA' })];
    const pathMap = mkPathMapStub([
      { filePath: 'notes/a.md', fileHash: 'hA', sourceMtime: 1, observedAt: 1 },
    ]);
    const hashCache = mkHashCacheStub(new Map([['hA', mkOkEntry('hA', chunks)]]));
    const { client } = makeFakeLLM({ deltas: ['out'] });
    const svc = new GenerationService({
      hashCache,
      pathMap,
      getNotebook: async () => mkNotebook('nb1'),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      clock: makeFakeClock(1),
    });
    // 自定义 title
    const evs1 = await collect(svc.generate('nb1', 'faq', { title: '  我的 FAQ  ' }));
    const done1 = evs1.find(e => e.type === 'done');
    if (done1 && done1.type === 'done') {
      expect(done1.artifact.title).toBe('我的 FAQ');
      expect(done1.artifact.kind).toBe('faq');
    }
    // 空 title fallback 到 defaultTitle
    const evs2 = await collect(svc.generate('nb1', 'briefing', { title: '   ' }));
    const done2 = evs2.find(e => e.type === 'done');
    if (done2 && done2.type === 'done') {
      expect(done2.artifact.title).toBe('执行简报');
    }
  });
});
