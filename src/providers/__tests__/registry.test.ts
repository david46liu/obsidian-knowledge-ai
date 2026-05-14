import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from 'src/providers/registry';
import type { Provider } from 'src/types/data';

const makeProvider = (id: string): Provider => ({
  id,
  displayName: 'Test',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  defaultModel: 'gpt-x',
  timeoutMs: 30000,
  capabilities: {
    supportsJsonMode: true,
    supportsStreaming: false,
    supportsTools: false,
    supportsTemperature: true,
    supportsMaxTokens: true,
    maxTokensFieldName: 'max_tokens',
    supportsEmbeddings: false,
    supportsVision: false,
  },
  createdAt: 0,
  updatedAt: 0,
});

describe('ProviderRegistry', () => {
  it('getClient returns same instance for same provider (cache)', () => {
    const reg = new ProviderRegistry();
    const p = makeProvider('p1');
    const c1 = reg.getClient(p);
    const c2 = reg.getClient(p);
    expect(c1).toBe(c2);
  });

  it('getClient returns new instance after invalidate', () => {
    const reg = new ProviderRegistry();
    const p = makeProvider('p1');
    const c1 = reg.getClient(p);
    reg.invalidate('p1');
    const c2 = reg.getClient(p);
    expect(c1).not.toBe(c2);
  });

  it('clear removes all cached clients', () => {
    const reg = new ProviderRegistry();
    const p = makeProvider('p2');
    const c1 = reg.getClient(p);
    reg.clear();
    const c2 = reg.getClient(p);
    expect(c1).not.toBe(c2);
  });
});
