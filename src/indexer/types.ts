import type { Chunk, HashCacheEntry, PathMapEntry, NotebookId } from 'src/types/data';

export type DiffClassification =
  | 'UNCHANGED'
  | 'MTIME_ONLY'
  | 'CONTENT_CHANGED'
  | 'NEW_PATH'
  | 'RENAMED'
  | 'DELETED'
  | 'STALE_PARSER';

export interface DiffEntry {
  classification: DiffClassification;
  filePath?: string;
  oldPath?: string;
  newPath?: string;
  newHash?: string;
  oldHash?: string;
  sourceMtime?: number;
  fileSize?: number;
}

export interface PipelineRunState {
  notebookId: NotebookId;
  done: number;
  total: number;
  errors: number;
  startedAt: number;
}

export type HashCacheJsonlLine = HashCacheEntry;
export type PathMapJsonlLine = PathMapEntry;

export interface ScanResult {
  entries: DiffEntry[];
  scannedFileCount: number;
}

export type HashContentFn = (bytes: Uint8Array) => Promise<string>;

export interface ChunkProductOk {
  kind: 'ok';
  hash: string;
  size: number;
  parserVersion: number;
  chunks: Chunk[];
  embeddings?: Record<string, number[]>;
  embeddingModelId?: string;
  embeddingError?: string;
}

export interface ChunkProductSkipped {
  kind: 'skipped';
  hash: string;
  size: number;
  parserVersion: number;
  reason: string;
}

export interface ChunkProductError {
  kind: 'error';
  hash: string;
  size: number;
  parserVersion: number;
  errorMessage: string;
}

export interface ChunkProductTransient {
  kind: 'transient';
  errorMessage: string;
  // 注意:transient 不写 HashCache,因此无 parserVersion 字段
}

export type ChunkProduct =
  | ChunkProductOk
  | ChunkProductSkipped
  | ChunkProductError
  | ChunkProductTransient;
