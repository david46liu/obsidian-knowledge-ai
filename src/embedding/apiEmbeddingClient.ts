import type { EmbeddingClient, EmbedOptions } from './types';

const MAX_BATCH_COUNT = 96;

export class BatchTooLargeError extends Error {
  constructor(count: number) {
    super(`Batch too large: ${count} texts (max ${MAX_BATCH_COUNT})`);
    this.name = 'BatchTooLargeError';
  }
}

export interface APIEmbeddingClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
}

export class APIEmbeddingClient implements EmbeddingClient {
  readonly modelId: string;
  readonly dimensions: number = 0;

  private readonly normalizedBase: string;

  constructor(private readonly cfg: APIEmbeddingClientConfig) {
    this.modelId = `${cfg.providerId}/${cfg.model}`;
    this.normalizedBase = cfg.baseUrl.replace(/\/v1$/, '');
  }

  async embedDocuments(texts: string[], opts?: EmbedOptions): Promise<number[][]> {
    if (texts.length > MAX_BATCH_COUNT) throw new BatchTooLargeError(texts.length);
    return this.callAPI(texts, opts);
  }

  async embedQuery(text: string, opts?: EmbedOptions): Promise<number[]> {
    const result = await this.callAPI([text], opts);
    return result[0];
  }

  private async callAPI(texts: string[], opts?: EmbedOptions): Promise<number[][]> {
    const res = await fetch(`${this.normalizedBase}/v1/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.cfg.model, input: texts }),
      signal: opts?.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Embedding API error ${res.status}: ${body}`);
    }

    const json = await res.json() as { data: Array<{ index: number; embedding: number[] }> };
    const result: number[][] = new Array(texts.length);
    for (const item of json.data) {
      result[item.index] = item.embedding;
    }
    return result;
  }
}
