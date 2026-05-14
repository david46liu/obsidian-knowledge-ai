import { create } from 'zustand';
import React from 'react';
import type { App } from 'obsidian';
import type { Provider, Notebook, TaskName, TaskAssignment, ProviderId, NotebookId, Source, SearchHit, Chunk, EmbeddingConfig, ImageConfig } from 'src/types/data';
import type { VectorCoverage } from 'src/ui/components/EmbeddingSection';
import type { ChatTurn, ChatSession, ChatStreamEvent, AskOptions } from 'src/types/chat';
import type { Artifact, ArtifactKind, GenerationStreamEvent, GenerateOptions } from 'src/types/artifact';

export type ProviderDraft = Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>;
import type { IndexerEventBus } from 'src/indexer/events';

export interface NotebookAIState {
  // 数据
  providers: Provider[];
  taskAssignments: Partial<Record<TaskName, TaskAssignment>>;
  notebooks: Notebook[];
  bannerDismissed: boolean;
  activeNotebookId: NotebookId | undefined;
  vaultFolders: string[];
  chatTab: 'chat' | 'artifacts';
  embeddingConfig: EmbeddingConfig;
  imageConfig: ImageConfig;

  // 同步 setters
  setProviders(ps: Provider[]): void;
  setTaskAssignments(ta: Partial<Record<TaskName, TaskAssignment>>): void;
  setNotebooks(nbs: Notebook[]): void;
  addProvider(p: Provider): void;
  updateProvider(p: Provider): void;
  removeProvider(id: ProviderId): void;
  addNotebook(nb: Notebook): void;
  updateNotebook(nb: Notebook): void;
  removeNotebook(id: NotebookId): void;
  setBannerDismissed(v: boolean): void;
  setActiveNotebookId(id: NotebookId | undefined): void;
  setVaultFolders(folders: string[]): void;
  setChatTab(t: 'chat' | 'artifacts'): void;
  setEmbeddingConfig(cfg: EmbeddingConfig): void;
  setImageConfig(cfg: ImageConfig): void;
}

export const useNotebookAIStore = create<NotebookAIState>()((set) => ({
  providers: [],
  taskAssignments: {},
  notebooks: [],
  bannerDismissed: false,
  activeNotebookId: undefined,
  vaultFolders: [],
  chatTab: 'chat',
  embeddingConfig: { enabled: false, source: 'local', localModelId: 'Xenova/multilingual-e5-small' },
  imageConfig: { ocrEnabled: true, ocrLangs: ['chi_sim', 'eng'], visionEnabled: true, maxImageBytes: 5_000_000 },

  setProviders: (ps) => set({ providers: ps }),
  setTaskAssignments: (ta) => set({ taskAssignments: ta }),
  setNotebooks: (nbs) => set({ notebooks: nbs }),
  addProvider: (p) => set(s => ({ providers: [...s.providers, p] })),
  updateProvider: (p) => set(s => ({
    providers: s.providers.map(x => x.id === p.id ? p : x),
  })),
  removeProvider: (id) => set(s => ({ providers: s.providers.filter(x => x.id !== id) })),
  addNotebook: (nb) => set(s => ({ notebooks: [...s.notebooks, nb] })),
  updateNotebook: (nb) => set(s => ({
    notebooks: s.notebooks.map(x => x.id === nb.id ? nb : x),
  })),
  removeNotebook: (id) => set(s => ({ notebooks: s.notebooks.filter(x => x.id !== id) })),
  setBannerDismissed: (v) => set({ bannerDismissed: v }),
  setActiveNotebookId: (id) => set({ activeNotebookId: id }),
  setVaultFolders: (folders) => set({ vaultFolders: folders }),
  setChatTab: (t) => set({ chatTab: t }),
  setEmbeddingConfig: (cfg) => set({ embeddingConfig: cfg }),
  setImageConfig: (cfg) => set({ imageConfig: cfg }),
}));

export interface PluginServices {
  /** Obsidian App 实例,供需要调 Obsidian API 的 UI 用(MarkdownRenderer 等) */
  app: App;
  testConnection(providerId: string): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  reindex(notebookId: NotebookId): Promise<void>;
  search(notebookId: NotebookId, query: string): Promise<SearchHit[]>;
  eventBus: IndexerEventBus;

  addProvider(draft: ProviderDraft): Promise<Provider>;
  updateProvider(p: Provider): Promise<void>;
  deleteProvider(id: ProviderId): Promise<void>;

  addNotebook(name: string, source: Source): Promise<Notebook>;
  updateNotebook(id: NotebookId, patch: Partial<Notebook>): Promise<Notebook>;
  deleteNotebook(id: NotebookId): Promise<void>;

  setTaskAssignment(task: TaskName, assignment: TaskAssignment | null): Promise<void>;
  setBannerDismissed(v: boolean): Promise<void>;

  openChatView(notebookId: NotebookId): Promise<void>;

  exportIndex(notebookId: NotebookId): Promise<{ vaultPath: string }>;
  clearCache(): Promise<void>;
  openDevTools(): void;

  /** 启动一次 RAG 会话流;返回 AsyncIterable */
  chat(notebookId: NotebookId, history: ChatTurn[], userText: string, opts?: AskOptions): AsyncIterable<ChatStreamEvent>;

  /** 加载 notebook 的 active 会话;若 notebook.activeConversationId 为空,创建新的并落盘 */
  loadActiveSession(notebookId: NotebookId): Promise<ChatSession>;

  /** 追加 turn 到会话(持久化) */
  appendTurn(notebookId: NotebookId, sessionId: string, turn: ChatTurn): Promise<void>;

  /** 在 vault 中打开文件并跳到指定字符偏移 */
  openVaultFile(filePath: string, charStart?: number): Promise<void>;

  /** 启动一次结构化产物生成流;返回 AsyncIterable */
  generate(notebookId: NotebookId, kind: ArtifactKind, opts?: GenerateOptions): AsyncIterable<GenerationStreamEvent>;

  /** 列出 notebook 的所有 artifacts(按 generatedAt desc) */
  listArtifacts(notebookId: NotebookId): Promise<Artifact[]>;

  /** 加载单个 artifact 全文 */
  loadArtifact(notebookId: NotebookId, artifactId: string): Promise<Artifact | null>;

  /** 删除 artifact */
  deleteArtifact(notebookId: NotebookId, artifactId: string): Promise<void>;

  /** 导出 artifact 到 vault(返回写入路径) */
  exportArtifact(artifactId: string): Promise<{ vaultPath: string }>;

  fetchChunksForFile(filePath: string, notebookId: NotebookId): Promise<{
    chunks: Chunk[];
    fileHash: string;
  } | null>;
  invalidateFileHash(filePath: string): Promise<void>;
  openChunksInspector(filePath: string, notebookId: NotebookId): void;

  saveEmbeddingConfig?: (cfg: EmbeddingConfig) => Promise<void>;
  downloadEmbeddingModel?: () => void;
  triggerFullReindex?: () => void;
  getEmbeddingCoverage?: () => VectorCoverage;

  /** 把指定 assistant turn 保存为 vault 中的新 markdown 文件 */
  saveTurnAsNote?: (notebookId: NotebookId, turnId: string) => Promise<{ vaultPath: string }>;

  saveImageConfig?: (cfg: ImageConfig) => Promise<void>;
  getOcrStatus?: () => 'not-ready' | 'initializing' | 'ready' | 'error';
  getOcrErrorMessage?: () => string | null;
  initOcr?: () => void;

  getEmbeddingDownloadState?: () => 'not-downloaded' | 'downloading' | 'ready' | 'error';
  getEmbeddingDownloadProgress?: () => number;
  getEmbeddingDownloadError?: () => string | null;

  /** 为 notebook 内已索引但缺失 summary 的文档批量生成摘要(P2.7)。返回控制器:cancel() 取消, promise 解析为最终统计。 */
  backfillSummaries?: (notebookId: NotebookId, opts?: { concurrency?: number }) => {
    cancel: () => void;
    promise: Promise<{ done: number; failed: number; total: number }>;
  };
  /** 当前 summary 覆盖率(用于设置页展示) */
  getSummaryCoverage?: (notebookId: NotebookId) => Promise<{ total: number; withSummary: number }>;

  /** 持久化 UI 语言到 pluginData.ui.locale 并立即调用 setLocale。下次重载完整生效。 */
  setLocale?: (locale: 'en' | 'zh-CN') => Promise<void>;
}

export const PluginServicesContext = React.createContext<PluginServices | null>(null);

export function usePluginServices(): PluginServices {
  const ctx = React.useContext(PluginServicesContext);
  if (!ctx) throw new Error('PluginServicesContext not provided');
  return ctx;
}
