import type { NotebookId } from 'src/types/data';

export type Role = 'system' | 'user' | 'assistant';

export interface Citation {
  /** 在答案中出现的 [N] 编号 */
  index: number;
  chunkId: string;
  filePath: string;
  headingPath: string[];
  /** chunk 在原文的起始字符偏移,用于跳转定位 */
  charStart: number;
  charEnd: number;
  /** chunk 内容预览(前 200 字),tooltip 用 */
  preview: string;
}

export interface ChatTurn {
  id: string;
  role: Role;
  content: string;
  /** 仅 assistant turn 有,user turn 不产生引用 */
  citations?: Citation[];
  createdAt: number;
  /** 是否被用户取消 */
  cancelled?: boolean;
  /** 是否出错;有此字段时 content 是错误信息 */
  error?: string;
}

export interface ChatSession {
  id: string;
  notebookId: NotebookId;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
}

export type ChatStreamEvent =
  | { type: 'retrieving' }
  | { type: 'reranking' }
  | { type: 'generating' }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'token'; content: string }
  | { type: 'done'; turn: ChatTurn }
  | { type: 'error'; error: string };

export interface AskOptions {
  rerank?: boolean;
  topK?: number;
  signal?: AbortSignal;
  /** 用 LLM 把用户问题改写成多个角度的检索查询(默认 true)。失败时回退到原查询。 */
  expandQuery?: boolean;
  /** 每个 hit 自动带上同文档前后 N 个相邻 chunk(默认 1,0=关闭)。 */
  expandNeighbors?: number;
  /**
   * 摘要模式 — 检测到「总结/汇总/亮点/有哪些」等问题时切换到「按文档分组」检索:
   * 扩大候选池,按文档去重(每文档保留最相关的 chunk),覆盖更广的文档面。
   * - auto: 关键词自动判断(默认)
   * - on:   强制开启
   * - off:  强制关闭
   */
  summaryMode?: 'auto' | 'on' | 'off';
}
