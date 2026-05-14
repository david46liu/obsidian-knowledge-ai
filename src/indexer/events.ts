import type { NotebookId } from 'src/types/data';
import type { EventBus } from 'src/infra/eventBus';

export interface IndexProgressPayload {
  notebookId: NotebookId;
  done: number;
  total: number;
  currentFile?: string;
}

export interface IndexCompletePayload {
  notebookId: NotebookId;
  fileCount: number;
  chunkCount: number;
  durationMs: number;
}

export interface IndexErrorPayload {
  notebookId: NotebookId;
  error: string;
  phase: 'scan' | 'chunk' | 'persist' | 'bm25';
}

export interface DirtyChangedPayload {
  notebookId: NotebookId;
  dirty: boolean;
  reason: 'vault-event' | 'indexed';
}

export interface SummaryProgressPayload {
  notebookId: NotebookId;
  done: number;
  failed: number;
  total: number;
  inFlight: number;
  /** 已跳过的"无可摘要内容"文档数(扫描版 PDF / 空 docx 等) */
  skipped?: number;
  /** 最近一次失败的错误信息(给 UI 排查用) */
  lastError?: string;
}

export interface IndexerEventMap extends Record<string, unknown> {
  'index:progress': IndexProgressPayload;
  'index:complete': IndexCompletePayload;
  'index:error': IndexErrorPayload;
  'index:dirty-changed': DirtyChangedPayload;
  'embeddings-invalidated': Record<string, never>;
  'summary:progress': SummaryProgressPayload;
}

export type IndexerEventBus = EventBus<IndexerEventMap>;
