import { describe, it, expect } from 'vitest';
import { TaskResolver } from 'src/tasks/resolver';
import { ProviderRegistry } from 'src/providers/registry';
import type { Provider, TaskAssignment, TaskName } from 'src/types/data';

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    displayName: 'Test',
    kind: 'openai-compatible',
    baseUrl: 'https://api.test.local/v1',
    apiKey: 'sk',
    defaultModel: 'model-default',
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
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    providerId: 'p1',
    model: 'model-rerank',
    enabled: true,
    sampling: { temperature: 0.1, maxTokens: 1000 },
    ...overrides,
  };
}

describe('TaskResolver', () => {
  it('resolves global assignment', () => {
    const providers = [makeProvider()];
    const global: Record<TaskName, TaskAssignment> = {
      chat: makeAssignment({ model: 'chat-model' }),
      rerank: makeAssignment({ model: 'rerank-model' }),
      summary: makeAssignment({ model: 'summary-model' }),
      embedding: makeAssignment({ enabled: false, model: 'embed-model' }),
      tts: makeAssignment({ enabled: false, model: 'tts-model' }),
      vision: makeAssignment({ enabled: false, model: 'vision-model' }),
    };
    const registry = new ProviderRegistry();
    const resolver = new TaskResolver(providers, global, registry);
    const resolved = resolver.resolve('rerank');
    expect(resolved).not.toBeNull();
    expect(resolved!.model).toBe('rerank-model');
  });

  it('notebook override takes priority over global', () => {
    const providers = [makeProvider()];
    const global: Record<TaskName, TaskAssignment> = {
      chat: makeAssignment({ model: 'global-chat' }),
      rerank: makeAssignment({ model: 'global-rerank' }),
      summary: makeAssignment({ model: 'global-summary' }),
      embedding: makeAssignment({ model: 'embed', enabled: false }),
      tts: makeAssignment({ model: 'tts', enabled: false }),
      vision: makeAssignment({ model: 'vision', enabled: false }),
    };
    const registry = new ProviderRegistry();
    const resolver = new TaskResolver(providers, global, registry);
    const notebookOverrides: Partial<Record<TaskName, TaskAssignment>> = {
      rerank: makeAssignment({ model: 'nb-rerank' }),
    };
    const resolved = resolver.resolve('rerank', notebookOverrides);
    expect(resolved!.model).toBe('nb-rerank');
  });

  it('returns null when task is disabled', () => {
    const providers = [makeProvider()];
    const global: Record<TaskName, TaskAssignment> = {
      chat: makeAssignment(),
      rerank: makeAssignment({ enabled: false }),
      summary: makeAssignment(),
      embedding: makeAssignment({ enabled: false }),
      tts: makeAssignment({ enabled: false }),
      vision: makeAssignment({ enabled: false }),
    };
    const registry = new ProviderRegistry();
    const resolver = new TaskResolver(providers, global, registry);
    expect(resolver.resolve('rerank')).toBeNull();
  });

  it('filters out temperature when not supported', () => {
    const noTempProvider = makeProvider({
      capabilities: {
        supportsJsonMode: false,
        supportsStreaming: false,
        supportsTools: false,
        supportsTemperature: false,
        supportsMaxTokens: true,
        maxTokensFieldName: 'max_tokens',
        supportsEmbeddings: false,
        supportsVision: false,
      },
    });
    const global: Record<TaskName, TaskAssignment> = {
      chat: makeAssignment({ sampling: { temperature: 0.7, maxTokens: 500 } }),
      rerank: makeAssignment(),
      summary: makeAssignment(),
      embedding: makeAssignment({ enabled: false }),
      tts: makeAssignment({ enabled: false }),
      vision: makeAssignment({ enabled: false }),
    };
    const registry = new ProviderRegistry();
    const resolver = new TaskResolver([noTempProvider], global, registry);
    const resolved = resolver.resolve('chat');
    expect(resolved!.params.temperature).toBeUndefined();
    expect(resolved!.params.maxTokens).toBe(500);
  });

  it('returns null when provider id does not match any provider', () => {
    const providers = [makeProvider({ id: 'p1' })];
    const global: Record<TaskName, TaskAssignment> = {
      chat: makeAssignment({ providerId: 'non-existent' }),
      rerank: makeAssignment(),
      summary: makeAssignment(),
      embedding: makeAssignment({ enabled: false }),
      tts: makeAssignment({ enabled: false }),
      vision: makeAssignment({ enabled: false }),
    };
    const registry = new ProviderRegistry();
    const resolver = new TaskResolver(providers, global, registry);
    expect(resolver.resolve('chat')).toBeNull();
  });

  it('returns null when provider is disabled', () => {
    const disabledProvider = makeProvider({ disabled: true });
    const global: Record<TaskName, TaskAssignment> = {
      chat: makeAssignment(),
      rerank: makeAssignment(),
      summary: makeAssignment(),
      embedding: makeAssignment({ enabled: false }),
      tts: makeAssignment({ enabled: false }),
      vision: makeAssignment({ enabled: false }),
    };
    const registry = new ProviderRegistry();
    const resolver = new TaskResolver([disabledProvider], global, registry);
    expect(resolver.resolve('chat')).toBeNull();
  });
});
