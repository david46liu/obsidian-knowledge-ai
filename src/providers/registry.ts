import { OpenAICompatibleClient } from './OpenAICompatibleClient';
import type { LLMClient } from './types';
import type { Provider } from 'src/types/data';

export class ProviderRegistry {
  private cache = new Map<string, LLMClient>();

  // Keyed by provider.id; call invalidate(id) after any config change to force rebuild.
  getClient(provider: Provider): LLMClient {
    let client = this.cache.get(provider.id);
    if (!client) {
      client = this.buildClient(provider);
      this.cache.set(provider.id, client);
    }
    return client;
  }

  invalidate(providerId: string): void {
    this.cache.delete(providerId);
  }

  clear(): void {
    this.cache.clear();
  }

  private buildClient(p: Provider): LLMClient {
    return new OpenAICompatibleClient(
      { baseUrl: p.baseUrl, apiKey: p.apiKey, timeoutMs: p.timeoutMs, defaultHeaders: p.defaultHeaders },
      p.capabilities
    );
  }
}
