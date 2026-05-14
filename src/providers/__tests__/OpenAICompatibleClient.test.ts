import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { OpenAICompatibleClient } from 'src/providers/OpenAICompatibleClient';
import type { ProviderCapabilities } from 'src/providers/types';

const capabilities: ProviderCapabilities = {
  supportsJsonMode: true,
  supportsStreaming: false,
  supportsTools: false,
  supportsTemperature: true,
  supportsMaxTokens: true,
  maxTokensFieldName: 'max_tokens',
  supportsEmbeddings: false,
  supportsVision: false,
};

const BASE = 'https://api.test.local/v1';

const server = setupServer(
  http.post(`${BASE}/chat/completions`, () =>
    HttpResponse.json({
      choices: [{ message: { role: 'assistant', content: 'pong' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('OpenAICompatibleClient.chat', () => {
  it('serializes multi-part content (text + image_url) verbatim in request body', async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${BASE}/chat/completions`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          choices: [{ message: { role: 'assistant', content: '描述' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      })
    );
    const client = new OpenAICompatibleClient({ baseUrl: BASE, apiKey: 'sk-test' }, capabilities);
    await client.chat({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请描述图片' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KG' } },
        ],
      }],
      model: 'gpt-4o',
    });
    const body = capturedBody as { messages: Array<{ content: unknown }> };
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: '请描述图片' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KG' } },
    ]);
  });

  it('sends Authorization header and returns content', async () => {
    let capturedAuthHeader: string | null = null;
    server.use(
      http.post(`${BASE}/chat/completions`, ({ request }) => {
        capturedAuthHeader = request.headers.get('Authorization');
        return HttpResponse.json({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      })
    );
    const client = new OpenAICompatibleClient({ baseUrl: BASE, apiKey: 'sk-test' }, capabilities);
    await client.chat({ messages: [{ role: 'user', content: 'ping' }], model: 'gpt-x' });
    expect(capturedAuthHeader).toBe('Bearer sk-test');
  });

  it('returns parsed content and usage', async () => {
    const client = new OpenAICompatibleClient({ baseUrl: BASE, apiKey: 'sk-test' }, capabilities);
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'gpt-x',
    });
    expect(result.content).toBe('pong');
    expect(result.usage?.totalTokens).toBe(6);
  });

  it('throws on 401', async () => {
    server.use(
      http.post(`${BASE}/chat/completions`, () =>
        HttpResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 })
      )
    );
    const client = new OpenAICompatibleClient({ baseUrl: BASE, apiKey: 'bad' }, capabilities);
    await expect(
      client.chat({ messages: [{ role: 'user', content: 'x' }], model: 'gpt-x' })
    ).rejects.toThrow('401');
  });

  it('respects AbortSignal', async () => {
    server.use(
      http.post(`${BASE}/chat/completions`, async () => {
        await new Promise(r => setTimeout(r, 500));
        return HttpResponse.json({ choices: [{ message: { content: 'late' } }] });
      })
    );
    const client = new OpenAICompatibleClient({ baseUrl: BASE, apiKey: 'sk' }, capabilities);
    const ac = new AbortController();
    const p = client.chat({
      messages: [{ role: 'user', content: 'x' }],
      model: 'gpt-x',
      signal: ac.signal,
    });
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});
