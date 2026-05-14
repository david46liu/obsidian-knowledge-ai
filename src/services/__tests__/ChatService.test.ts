import { describe, it, expect, vi } from 'vitest';
import { ChatService, type ResolvedTaskClient } from 'src/services/ChatService';
import type { SearchService } from 'src/services/SearchService';
import { makeFakeClock } from 'src/infra/clock';
import type { Chunk, SearchHit } from 'src/types/data';
import type { ChatStreamEvent, ChatTurn } from 'src/types/chat';
import type { ChatMessage, ChatOptions, LLMClient, ProviderCapabilities, StreamEvent } from 'src/providers/types';

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
    fileHash: id.split(':')[0] ?? 'h',
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

function mkHit(id: string, content: string, opts: Partial<Chunk> = {}): SearchHit {
  return {
    chunk: mkChunk(id, content, opts),
    bm25Score: 1,
    finalRank: 0,
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
    async chat() { return { content: '' }; },
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

function makeFakeSearch(hits: SearchHit[]): SearchService {
  return {
    search: vi.fn(async () => hits),
  } as unknown as SearchService;
}

async function collect(iter: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('ChatService', () => {
  it('emits citations:[] + generating + done when search returns no hits', async () => {
    const { client } = makeFakeLLM({ deltas: ['hello'] });
    const svc = new ChatService({
      searchService: makeFakeSearch([]),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      getNotebookSystemPrompt: async () => null,
      clock: makeFakeClock(1000),
    });
    const events = await collect(svc.ask('nb1', [], 'q'));
    const types = events.map(e => e.type);
    expect(types).toContain('retrieving');
    expect(types).toContain('citations');
    expect(types).toContain('generating');
    expect(types).toContain('token');
    expect(types).toContain('done');

    const cit = events.find(e => e.type === 'citations');
    expect(cit && cit.type === 'citations' && cit.citations).toEqual([]);
  });

  it('does not emit reranking when rerank=false', async () => {
    const { client } = makeFakeLLM({ deltas: ['x'] });
    const svc = new ChatService({
      searchService: makeFakeSearch([]),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      getNotebookSystemPrompt: async () => null,
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.ask('nb1', [], 'q', { rerank: false }));
    expect(events.some(e => e.type === 'reranking')).toBe(false);
    expect(events.some(e => e.type === 'retrieving')).toBe(true);
  });

  it('emits error and no done when resolveTaskClient returns null', async () => {
    const svc = new ChatService({
      searchService: makeFakeSearch([]),
      resolveTaskClient: () => null,
      getNotebookSystemPrompt: async () => null,
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.ask('nb1', [], 'q'));
    const errs = events.filter(e => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].type === 'error' && errs[0].error).toMatch(/未配置/);
    expect(events.some(e => e.type === 'done')).toBe(false);
  });

  it('emits error when chatStream throws', async () => {
    const { client } = makeFakeLLM({ throw: new Error('llm-blew-up') });
    const svc = new ChatService({
      searchService: makeFakeSearch([]),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      getNotebookSystemPrompt: async () => null,
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.ask('nb1', [], 'q'));
    const errs = events.filter(e => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].type === 'error' && errs[0].error).toBe('llm-blew-up');
  });

  it('stops accumulating on signal.abort and emits done with cancelled=true', async () => {
    const ctrl = new AbortController();
    // Fake LLM that yields multiple deltas; we abort after first.
    const captured: ChatMessage[][] = [];
    const client: LLMClient = {
      capabilities: CAPS,
      async chat() { return { content: '' }; },
      chatStream(opts: ChatOptions): AsyncIterable<StreamEvent> {
        captured.push(opts.messages);
        return (async function* () {
          yield { type: 'delta', content: 'hello' };
          ctrl.abort();
          yield { type: 'delta', content: 'should-be-ignored' };
        })();
      },
    };
    const svc = new ChatService({
      searchService: makeFakeSearch([]),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      getNotebookSystemPrompt: async () => null,
      clock: makeFakeClock(1234),
    });
    const events = await collect(svc.ask('nb1', [], 'q', { signal: ctrl.signal }));
    const tokens = events.filter(e => e.type === 'token');
    expect(tokens).toHaveLength(1);
    const done = events.find(e => e.type === 'done');
    expect(done).toBeDefined();
    if (done && done.type === 'done') {
      expect(done.turn.cancelled).toBe(true);
      expect(done.turn.content).toBe('hello');
    }
  });

  it('buildMessages preserves history order; filters role=system and error turns; appends user', async () => {
    const { client, capturedMessages } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new ChatService({
      searchService: makeFakeSearch([]),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      getNotebookSystemPrompt: async () => null,
      clock: makeFakeClock(1),
    });
    const history: ChatTurn[] = [
      { id: 'h0', role: 'system', content: 'should-be-filtered-system', createdAt: 1 },
      { id: 'h1', role: 'user', content: 'first user', createdAt: 2 },
      { id: 'h2', role: 'assistant', content: 'first assistant', createdAt: 3 },
      { id: 'h3', role: 'assistant', content: 'oops', createdAt: 4, error: 'rate-limit' },
      { id: 'h4', role: 'user', content: 'second user', createdAt: 5 },
    ];
    await collect(svc.ask('nb1', history, 'NEW-Q'));
    expect(capturedMessages).toHaveLength(1);
    const msgs = capturedMessages[0];
    // [0] system (built), [1] first user, [2] first assistant, [3] second user, [4] NEW user
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: 'first user' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'first assistant' });
    expect(msgs[3]).toEqual({ role: 'user', content: 'second user' });
    expect(msgs[4]).toEqual({ role: 'user', content: 'NEW-Q' });
    expect(msgs).toHaveLength(5);
    // No filtered content leaked into the system block either.
    expect(msgs[0].content).not.toContain('should-be-filtered-system');
    expect(msgs.some(m => typeof m.content === 'string' && m.content.includes('oops'))).toBe(false);
  });

  it('respects MAX_CONTEXT_TOKENS budget; oversized 2nd chunk excluded but 1st kept', async () => {
    // chunk 1 small (so always included)
    // chunk 2 very large (tokenCount + 30 > budget) -> break, NOT included
    // chunk 3 also dropped (loop broke)
    const hits: SearchHit[] = [
      mkHit('hA:0', 'small first', { tokenCount: 10 }),
      mkHit('hB:0', 'big chunk content', { tokenCount: 999_999 }),
      mkHit('hC:0', 'third', { tokenCount: 5 }),
    ];
    const { client, capturedMessages } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new ChatService({
      searchService: makeFakeSearch(hits),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      getNotebookSystemPrompt: async () => null,
      clock: makeFakeClock(1),
    });
    await collect(svc.ask('nb1', [], 'q'));
    const sysContent = capturedMessages[0][0].content;
    expect(sysContent).toContain('[1]');
    expect(sysContent).toContain('small first');
    expect(sysContent).not.toContain('big chunk content');
    expect(sysContent).not.toContain('[2]');
    expect(sysContent).not.toContain('[3]');
  });

  it('buildCitations numbers citations starting from 1', async () => {
    const hits: SearchHit[] = [
      mkHit('hA:0', 'one', { headingPath: ['Topic A'] }),
      mkHit('hB:0', 'two'),
      mkHit('hC:0', 'three'),
    ];
    const { client } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new ChatService({
      searchService: makeFakeSearch(hits),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      getNotebookSystemPrompt: async () => null,
      clock: makeFakeClock(1),
    });
    const events = await collect(svc.ask('nb1', [], 'q'));
    const cit = events.find(e => e.type === 'citations');
    expect(cit && cit.type === 'citations').toBe(true);
    if (cit && cit.type === 'citations') {
      expect(cit.citations.map(c => c.index)).toEqual([1, 2, 3]);
      expect(cit.citations[0].chunkId).toBe('hA:0');
      expect(cit.citations[0].preview).toBe('one');
    }
  });

  it('falls back to DEFAULT_SYSTEM_PROMPT when getNotebookSystemPrompt returns null', async () => {
    const { client, capturedMessages } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new ChatService({
      searchService: makeFakeSearch([]),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      getNotebookSystemPrompt: async () => null,
      clock: makeFakeClock(1),
    });
    await collect(svc.ask('nb1', [], 'q'));
    const sys = capturedMessages[0][0].content;
    expect(sys).toContain('基于用户笔记的智能助手');
    expect(sys).toContain('[N]');
  });

  it('falls back to DEFAULT_SYSTEM_PROMPT when getNotebookSystemPrompt returns whitespace', async () => {
    const { client, capturedMessages } = makeFakeLLM({ deltas: ['ok'] });
    const svc = new ChatService({
      searchService: makeFakeSearch([]),
      resolveTaskClient: (): ResolvedTaskClient => ({ client, model: 'm' }),
      getNotebookSystemPrompt: async () => '   ',
      clock: makeFakeClock(1),
    });
    await collect(svc.ask('nb1', [], 'q'));
    const sys = capturedMessages[0][0].content;
    expect(sys).toContain('基于用户笔记的智能助手');
  });
});
