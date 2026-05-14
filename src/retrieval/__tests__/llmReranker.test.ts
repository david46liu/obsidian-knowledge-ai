import { describe, it, expect } from 'vitest';
import { LLMReranker } from 'src/retrieval/llmReranker';
import type { LLMClient, ChatOptions } from 'src/providers/types';
import type { SearchHit } from 'src/types/data';

function mkHit(id: string, content: string, bm25Score = 1, heading = ''): SearchHit {
  return {
    chunk: {
      id, chunkIndex: 0, fileHash: 'h', filePath: 'a.md', sourceId: 's',
      headingText: heading, headingPath: heading ? heading.split(' > ') : [],
      content, contentHash: 'hh', tokenCount: content.length,
      charStart: 0, charEnd: content.length, kind: 'paragraph',
    },
    bm25Score, finalRank: 0,
  };
}

function mockClient(response: string, supportsJsonMode = true): LLMClient {
  return {
    capabilities: {
      supportsJsonMode, supportsStreaming: true, supportsTools: false,
      supportsTemperature: true, supportsMaxTokens: true,
      maxTokensFieldName: 'max_tokens', supportsEmbeddings: false, supportsVision: false,
    },
    async chat(_: ChatOptions) { return { content: response }; },
    async *chatStream() { yield { type: 'done' as const }; },
  };
}

describe('LLMReranker', () => {
  it('reorders hits by returned score', async () => {
    const hits = [mkHit('1', 'x'), mkHit('2', 'y'), mkHit('3', 'z')];
    const client = mockClient(JSON.stringify({
      rankings: [{ index: 2, score: 9 }, { index: 3, score: 5 }, { index: 1, score: 1 }],
    }));
    const r = new LLMReranker(client, 'model-x');
    const out = await r.rerank('q', hits);
    expect(out.map(h => h.chunk.id)).toEqual(['2', '3', '1']);
    expect(out.map(h => h.rerankScore)).toEqual([9, 5, 1]);
    expect(out.map(h => h.finalRank)).toEqual([0, 1, 2]);
  });

  it('falls back to original order on invalid JSON', async () => {
    const hits = [mkHit('1', 'x'), mkHit('2', 'y')];
    const client = mockClient('not json at all');
    const r = new LLMReranker(client, 'm');
    const out = await r.rerank('q', hits);
    expect(out.map(h => h.chunk.id)).toEqual(['1', '2']);
  });

  it('ignores out-of-range index', async () => {
    const hits = [mkHit('1', 'x'), mkHit('2', 'y')];
    const client = mockClient(JSON.stringify({
      rankings: [{ index: 99, score: 9 }, { index: 2, score: 5 }],
    }));
    const r = new LLMReranker(client, 'm');
    const out = await r.rerank('q', hits);
    expect(out[0].chunk.id).toBe('2');
    expect(new Set(out.map(h => h.chunk.id))).toEqual(new Set(['1', '2']));
  });

  it('passes response_format when provider supports json mode', async () => {
    let captured: ChatOptions | null = null;
    const client: LLMClient = {
      capabilities: {
        supportsJsonMode: true, supportsStreaming: true, supportsTools: false,
        supportsTemperature: true, supportsMaxTokens: true, maxTokensFieldName: 'max_tokens', supportsEmbeddings: false, supportsVision: false,
      },
      async chat(opts) { captured = opts; return { content: '{"rankings":[]}' }; },
      async *chatStream() { yield { type: 'done' as const }; },
    };
    const r = new LLMReranker(client, 'm');
    await r.rerank('q', [mkHit('1', 'x')]);
    expect((captured as ChatOptions | null)?.responseFormat).toBe('json_object');
  });

  it('does NOT set response_format when provider lacks json mode', async () => {
    let captured: ChatOptions | null = null;
    const client: LLMClient = {
      capabilities: {
        supportsJsonMode: false, supportsStreaming: true, supportsTools: false,
        supportsTemperature: true, supportsMaxTokens: true, maxTokensFieldName: 'max_tokens', supportsEmbeddings: false, supportsVision: false,
      },
      async chat(opts) { captured = opts; return { content: '{"rankings":[]}' }; },
      async *chatStream() { yield { type: 'done' as const }; },
    };
    const r = new LLMReranker(client, 'm');
    await r.rerank('q', [mkHit('1', 'x')]);
    expect((captured as ChatOptions | null)?.responseFormat).toBeUndefined();
  });
});
