import { describe, it, expect, vi } from 'vitest';
import { callVision } from 'src/providers/visionCall';
import type { ChatOptions, LLMClient, ProviderCapabilities, ContentPart } from 'src/providers/types';

const caps: ProviderCapabilities = {
  supportsJsonMode: true, supportsStreaming: true, supportsTools: false,
  supportsTemperature: true, supportsMaxTokens: true, maxTokensFieldName: 'max_tokens',
  supportsEmbeddings: false, supportsVision: true,
};

function mockClient(impl: (opts: ChatOptions) => Promise<{ content: string }>): LLMClient {
  return {
    capabilities: caps,
    chat: impl as LLMClient['chat'],
    async *chatStream() { yield { type: 'done' as const }; },
  };
}

describe('callVision', () => {
  it('builds a data URL with given mime type and sends as image_url part', async () => {
    let captured: ChatOptions | null = null;
    const client = mockClient(async (opts) => {
      captured = opts;
      return { content: '这是一张测试图片' };
    });
    const bytes = new Uint8Array([72, 73]).buffer;  // "HI"
    const out = await callVision({ client, model: 'gpt-4o', imageBytes: bytes, mimeType: 'image/png' });
    expect(out).toBe('这是一张测试图片');
    const opts = captured! as ChatOptions;
    expect(opts.model).toBe('gpt-4o');
    expect(opts.messages.length).toBe(1);
    expect(opts.messages[0].role).toBe('user');
    const parts = opts.messages[0].content as ContentPart[];
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('text');
    const imgPart = parts[1] as Extract<ContentPart, { type: 'image_url' }>;
    expect(imgPart.image_url.url).toBe('data:image/png;base64,SEk=');
  });

  it('uses image/jpeg mime when specified', async () => {
    let captured: ChatOptions | null = null;
    const client = mockClient(async (opts) => { captured = opts; return { content: 'ok' }; });
    await callVision({ client, model: 'm', imageBytes: new Uint8Array([1]).buffer, mimeType: 'image/jpeg' });
    const parts = (captured! as ChatOptions).messages[0].content as ContentPart[];
    const imgPart = parts[1] as Extract<ContentPart, { type: 'image_url' }>;
    expect(imgPart.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('passes signal through to client.chat', async () => {
    let captured: ChatOptions | null = null;
    const client = mockClient(async (opts) => { captured = opts; return { content: 'ok' }; });
    const ctrl = new AbortController();
    await callVision({ client, model: 'm', imageBytes: new Uint8Array([1]).buffer, mimeType: 'image/png', signal: ctrl.signal });
    expect((captured as unknown as ChatOptions).signal).toBe(ctrl.signal);
  });

  it('throws when client returns empty content', async () => {
    const client = mockClient(async () => ({ content: '   ' }));
    await expect(callVision({ client, model: 'm', imageBytes: new Uint8Array([1]).buffer, mimeType: 'image/png' }))
      .rejects.toThrow(/empty/i);
  });

  it('trims trailing/leading whitespace in response', async () => {
    const client = mockClient(async () => ({ content: '  描述文本  ' }));
    const out = await callVision({ client, model: 'm', imageBytes: new Uint8Array([1]).buffer, mimeType: 'image/png' });
    expect(out).toBe('描述文本');
  });
});
