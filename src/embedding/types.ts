import type { EmbeddingConfig } from 'src/types/data';
export type { EmbeddingConfig };

export interface EmbedOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EmbeddingClient {
  readonly modelId: string;
  readonly dimensions: number;
  embedDocuments(texts: string[], opts?: EmbedOptions): Promise<number[][]>;
  embedQuery(text: string, opts?: EmbedOptions): Promise<number[]>;
}
