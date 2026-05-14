import { describe, it, expect } from 'vitest';
import { parseSSEStream } from 'src/providers/sseParser';
import type { StreamEvent } from 'src/providers/types';

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('parseSSEStream', () => {
  it('parses single complete delta event', async () => {
    const stream = makeStream(['data: {"choices":[{"delta":{"content":"hello"}}]}\n\n']);
    const events: StreamEvent[] = [];
    for await (const e of parseSSEStream(stream)) events.push(e);
    expect(events).toEqual([{ type: 'delta', content: 'hello' }]);
  });

  it('handles [DONE] sentinel and emits done', async () => {
    const stream = makeStream([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const events: StreamEvent[] = [];
    for await (const e of parseSSEStream(stream)) events.push(e);
    expect(events[0]).toEqual({ type: 'delta', content: 'hi' });
    expect(events[1].type).toBe('done');
  });

  it('handles chunked frames split across network packets', async () => {
    // "data: {..." split into two TCP chunks
    const stream = makeStream([
      'data: {"choices":[{"delta":{"cont',
      'ent":"split"}}]}\n\n',
    ]);
    const events: StreamEvent[] = [];
    for await (const e of parseSSEStream(stream)) events.push(e);
    expect(events).toEqual([{ type: 'delta', content: 'split' }]);
  });

  it('skips non-data lines (comments, empty)', async () => {
    const stream = makeStream([
      ': keep-alive\n',
      '\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    ]);
    const events: StreamEvent[] = [];
    for await (const e of parseSSEStream(stream)) events.push(e);
    expect(events).toEqual([{ type: 'delta', content: 'ok' }]);
  });

  it('emits done with usage when server sends usage field', async () => {
    const payload = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const stream = makeStream([`data: ${payload}\n\n`]);
    const events: StreamEvent[] = [];
    for await (const e of parseSSEStream(stream)) events.push(e);
    expect(events).toEqual([{
      type: 'done',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }]);
  });

  it('preserves usage when [DONE] and usage appear in same SSE block', async () => {
    const usagePayload = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 },
    });
    const stream = makeStream([`data: ${usagePayload}\ndata: [DONE]\n\n`]);
    const events: StreamEvent[] = [];
    for await (const e of parseSSEStream(stream)) events.push(e);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'done',
      usage: { promptTokens: 3, completionTokens: 7, totalTokens: 10 },
    });
  });
});
