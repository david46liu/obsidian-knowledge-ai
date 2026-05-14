import type { SearchHit } from 'src/types/data';

export interface Reranker {
  readonly name: string;
  rerank(query: string, candidates: SearchHit[]): Promise<SearchHit[]>;
}

export const INDEX_SCHEMA_VERSION = 1;
