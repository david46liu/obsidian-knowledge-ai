import type { NotebookId } from 'src/types/data';
import type { Citation } from 'src/types/chat';

export type ArtifactKind = 'summary' | 'study-guide' | 'timeline' | 'faq' | 'briefing' | 'mind-map' | 'ppt';

export interface Artifact {
  id: string;
  notebookId: NotebookId;
  kind: ArtifactKind;
  title: string;
  content: string;
  citations: Citation[];
  modelUsed: string;
  generatedAt: number;
  truncated?: boolean;
}

export type GenerationStreamEvent =
  | { type: 'retrieving' }
  | { type: 'generating' }
  | { type: 'citations'; citations: Citation[]; truncated: boolean }
  | { type: 'token'; content: string }
  | { type: 'done'; artifact: Artifact }
  | { type: 'error'; error: string };

export interface GenerateOptions {
  signal?: AbortSignal;
  /** 用户可覆盖 generator 默认 title */
  title?: string;
}
