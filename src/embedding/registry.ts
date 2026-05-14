import type { EmbeddingClient } from './types';

export class EmbeddingClientRegistry {
  private current: EmbeddingClient | undefined;

  register(client: EmbeddingClient): void {
    this.current = client;
  }

  get(): EmbeddingClient | undefined {
    return this.current;
  }

  clear(): void {
    this.current = undefined;
  }
}
