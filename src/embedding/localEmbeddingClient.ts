import type { EmbeddingClient, EmbedOptions } from './types';
import type { EmbeddingWorkerHost } from './worker/EmbeddingWorkerHost';

export interface LocalEmbeddingClientConfig {
  host: EmbeddingWorkerHost;
  modelId: string;
  dimensions: number;
}

export class LocalEmbeddingClient implements EmbeddingClient {
  readonly modelId: string;
  readonly dimensions: number;

  constructor(private readonly cfg: LocalEmbeddingClientConfig) {
    this.modelId = cfg.modelId;
    this.dimensions = cfg.dimensions;
  }

  async embedDocuments(texts: string[], opts?: EmbedOptions): Promise<number[][]> {
    return this.cfg.host.embed({ texts, type: 'document', signal: opts?.signal });
  }

  async embedQuery(text: string, opts?: EmbedOptions): Promise<number[]> {
    const result = await this.cfg.host.embed({ texts: [text], type: 'query', signal: opts?.signal });
    return result[0];
  }
}
