import type { Reranker } from 'src/retrieval/types';

export class RerankerRegistry {
  private readonly byName = new Map<string, Reranker>();

  register(r: Reranker): void {
    this.byName.set(r.name, r);
  }

  get(name: string): Reranker | undefined {
    return this.byName.get(name);
  }

  list(): string[] {
    return [...this.byName.keys()];
  }
}
