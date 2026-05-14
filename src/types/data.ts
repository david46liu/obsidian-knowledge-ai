export type ProviderId = string;

export type ProviderKind = 'openai-compatible' | 'openai' | 'glm' | 'custom';

export interface ProviderCapabilities {
  supportsJsonMode: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsTemperature: boolean;
  supportsMaxTokens: boolean;
  maxTokensFieldName: 'max_tokens' | 'max_completion_tokens';
  maxContextTokens?: number;
  supportsEmbeddings: boolean;
  supportsVision: boolean;
}

export interface Provider {
  id: ProviderId;
  displayName: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs: number;
  capabilities: ProviderCapabilities;
  disabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type TaskName = 'chat' | 'rerank' | 'summary' | 'embedding' | 'tts' | 'vision';

export interface SamplingParams {
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface TaskAssignment {
  providerId: ProviderId;
  model: string;
  enabled?: boolean;
  timeoutMs?: number;
  sampling?: SamplingParams;
  providerOptions?: Record<string, unknown>;
}

export type NotebookId = string;
export type SourceId = string;

export interface Source {
  id: SourceId;
  type: 'folder';
  path: string;
  recursive: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  enabled?: boolean;
}

export interface NotebookIndexConfig {
  maxTokens: number;
  overlapTokens: number;
  candidateK: number;
  topK: number;
}

export type NotebookStatus = 'idle' | 'indexing' | 'dirty' | 'error';

export interface NotebookOfficeOptions {
  /**
   * pptx 演讲者备注是否纳入索引;默认 false。
   * 备注常含未公开内容,启用前在 UI 弹 confirm 提示用户。
   */
  includePptxNotes?: boolean;
}

export interface NotebookTransientFileError {
  path: string;
  message: string;
  /** 错误观测时间(epoch ms) */
  ts: number;
}

export interface NotebookPersistentFileError {
  path: string;
  message: string;
  /** 错误观测时间(epoch ms) */
  ts: number;
}

export interface Notebook {
  id: NotebookId;
  name: string;
  sources: Source[];
  primarySourceId?: SourceId;
  taskOverrides?: Partial<Record<TaskName, TaskAssignment>>;
  systemPrompt?: string;
  indexConfig?: Partial<NotebookIndexConfig>;
  status: NotebookStatus;
  lastIndexedAt?: number;
  lastIndexError?: string;
  lastIndexVersion?: number;
  stats?: { fileCount: number; chunkCount: number };
  /** 当前 active 的对话 id;UI 打开 ChatView 时 default 跳到此会话 */
  activeConversationId?: string;
  /** 当前 active 的 artifact id;ArtifactsTab 默认定位 */
  activeArtifactId?: string;
  /**
   * 此 notebook 启用索引的扩展名集(小写、不含点)。
   * undefined → fallback 到 ['md'](零破坏性升级)。
   */
  fileExtensions?: string[];
  /** Office 解析行为开关。所有字段默认值为安全侧(关闭/不索引)。 */
  officeOptions?: NotebookOfficeOptions;
  /**
   * 最近一次 reindex 中遇到的 transient 错误(timeout/worker-crash/oom)。
   * FIFO 保留最近 20 条;UI 可显示"N 个文件未索引,可重试"。
   */
  transientFileErrors?: NotebookTransientFileError[];
  /**
   * 最近一次 reindex 中遇到的 deterministic parse 错误(文件损坏/不支持结构等)。
   * 与 transient 不同,这些错误重试无效,需要用户修复或替换文件。
   * FIFO 保留最近 20 条。
   */
  persistentFileErrors?: NotebookPersistentFileError[];
  createdAt: number;
  updatedAt: number;
}

export type ChunkKind = 'paragraph' | 'code' | 'table' | 'list' | 'mixed';

export type Locator =
  | { kind: 'slide'; index: number; title?: string; isNote?: boolean }
  | { kind: 'sheet'; name: string; rowRange?: [number, number] }
  | { kind: 'page'; pageRange: [number, number] };

export interface Chunk {
  id: string;
  chunkIndex: number;
  fileHash: string;
  filePath: string;
  sourceId: SourceId;
  headingText: string;
  headingPath: string[];
  content: string;
  contentHash: string;
  tokenCount: number;
  charStart: number;
  charEnd: number;
  kind: ChunkKind;
  /** 来源格式特有的位置信息;markdown chunk 不写此字段。 */
  locator?: Locator;
}

export interface HashCacheEntry {
  fileHash: string;
  fileSize: number;
  chunks: Chunk[];
  embeddings?: Record<string, number[]>;
  chunkingVersion: number;
  parserVersion: number;
  indexedAt: number;
  status: 'ok' | 'skipped' | 'error';
  errorMessage?: string;
  tombstone?: boolean;
  embeddingModelId?: string;
  embeddingError?: string;
  /** 文档级摘要(200 字以内),用于 summaryMode 的"按文档主题检索"。 */
  summary?: string;
  /** 生成 summary 时用的 LLM model id;模型变化时可用于判断是否需要重新生成。 */
  summaryModelId?: string;
}

export interface PathMapEntry {
  filePath: string;
  fileHash: string;
  sourceMtime: number;
  observedAt: number;
  tombstone?: boolean;
}

export interface BM25Index {
  notebookId: NotebookId;
  miniSearchState: unknown;
  schemaVersion: number;
  chunkingVersion: number;
}

export interface SearchHit {
  chunk: Chunk;
  bm25Score?: number;
  vectorScore?: number;
  rrfScore?: number;
  rerankScore?: number;
  finalRank: number;
}

export interface SearchOptions {
  topK?: number;
  candidateK?: number;
  rerank?: boolean;
  staleOk?: boolean;
  filter?: (chunk: Chunk) => boolean;
  useVector?: boolean;
}

export interface EmbeddingConfig {
  enabled: boolean;
  source: 'api' | 'local';
  apiProviderId?: string;
  apiModel?: string;
  localModelId?: string;
}

export interface ImageConfig {
  ocrEnabled: boolean;
  ocrLangs: string[];
  visionEnabled: boolean;
  maxImageBytes: number;
}

export interface PluginData {
  schemaVersion: 1;
  providers: Provider[];
  taskAssignments: Partial<Record<TaskName, TaskAssignment>>;
  featureFlags?: Record<string, boolean>;
  diagnostics?: {
    bannerDismissed?: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
  };
  ui?: {
    activeNotebookId?: NotebookId;
    /** Persisted locale. If unset, falls back to Obsidian's moment.locale() then 'en'. */
    locale?: 'en' | 'zh-CN';
  };
  embeddingConfig?: EmbeddingConfig;
  imageConfig?: ImageConfig;
}
