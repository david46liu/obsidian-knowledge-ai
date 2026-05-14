import { Plugin, ItemView, PluginSettingTab, WorkspaceLeaf, FileSystemAdapter, Platform } from 'obsidian';
import type { App as ObsidianApp } from 'obsidian';
import { createRoot } from 'react-dom/client';
import React from 'react';

import { createLogger } from 'src/infra/logger';
import { createEventBus } from 'src/infra/eventBus';
import { realClock } from 'src/infra/clock';

import { VaultAdapter } from 'src/adapters/VaultAdapter';
import { DataStoreAdapter } from 'src/adapters/DataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';

import { HashCacheStore } from 'src/indexer/hashCache';
import { PathMapStore } from 'src/indexer/pathMap';
import { createVaultObserver } from 'src/indexer/observer';
import type { IndexerEventBus } from 'src/indexer/events';
import type { IndexerEventMap } from 'src/indexer/events';

import { NotebookService } from 'src/services/NotebookService';
import { IndexService } from 'src/services/IndexService';
import { SearchService } from 'src/services/SearchService';
import { ChatService } from 'src/services/ChatService';
import { SummaryService } from 'src/services/SummaryService';
import { SessionStore } from 'src/services/SessionStore';
import { GenerationService } from 'src/services/GenerationService';
import { ArtifactStore } from 'src/services/ArtifactStore';

import { BM25Store } from 'src/retrieval/bm25';
import { RerankerRegistry } from 'src/retrieval/rerank';
import { LLMReranker } from 'src/retrieval/llmReranker';
import { ExtractorRegistry } from 'src/extraction/registry';
import { WebWorkerHost } from 'src/extraction/worker/WebWorkerHost';
import { LaneScheduler } from 'src/extraction/worker/laneScheduler';
import { SOFT_WARN_BYTES } from 'src/services/officeLimits';

import { ProviderRegistry } from 'src/providers/registry';
import { TaskResolver } from 'src/tasks/resolver';

import { CHUNKING_VERSION } from 'src/chunking/types';

import type { NotebookId, TaskName, TaskAssignment, SearchHit, EmbeddingConfig } from 'src/types/data';
import { EmbeddingClientRegistry } from 'src/embedding/registry';
import { EmbeddingWorkerHost } from 'src/embedding/worker/EmbeddingWorkerHost';
import { APIEmbeddingClient } from 'src/embedding/apiEmbeddingClient';
import { LocalEmbeddingClient } from 'src/embedding/localEmbeddingClient';
import { VectorStore } from 'src/embedding/vectorStore';
import { invalidateAllEmbeddings } from 'src/services/IndexService';
import { useNotebookAIStore, PluginServicesContext, type PluginServices } from 'src/ui/hooks/useStore';
import { setLocale, resolveDefaultLocale, t } from 'src/i18n';

import { App } from 'src/ui/App';
import { ChatView } from 'src/ui/views/ChatView';
import { TFile, TFolder, Notice } from 'obsidian';
import { ChunksInspectorModal } from 'src/ui/modals/ChunksInspectorModal';
import type { Notebook } from 'src/types/data';
import { showRibbonContextMenu } from 'src/ui/menus/ribbonContextMenu';
import { attachFolderContextMenu } from 'src/ui/menus/folderContextMenu';
import { attachFileContextMenu } from 'src/ui/menus/fileContextMenu';
import { FolderMarkers } from 'src/ui/folderMarkers';
import { buildNoteFilename, buildNoteMarkdown } from 'src/services/saveTurnAsNote';
import { OCRWorkerHost } from 'src/extraction/image/ocrWorkerHost';
import { makeImageExtractor } from 'src/extraction/image/extractor';

const BM25_LRU_MAX = 3;
const COMPACT_INTERVAL_MS = 5 * 60 * 1000;
const DIRTY_DEBOUNCE_MS = 2000;

class BM25LRU {
  private readonly cache = new Map<NotebookId, BM25Store>();
  private readonly order: NotebookId[] = [];

  constructor(
    private readonly make: (id: NotebookId) => BM25Store,
    private readonly max = BM25_LRU_MAX
  ) {}

  get(id: NotebookId): BM25Store {
    if (this.cache.has(id)) {
      const idx = this.order.indexOf(id);
      if (idx !== -1) this.order.splice(idx, 1);
      this.order.push(id);
      return this.cache.get(id)!;
    }
    if (this.cache.size >= this.max) {
      const lru = this.order.shift()!;
      this.cache.delete(lru);
    }
    const store = this.make(id);
    this.cache.set(id, store);
    this.order.push(id);
    return store;
  }

  clear(): void {
    this.cache.clear();
    this.order.length = 0;
  }
}

function notebookCoversFile(nb: Notebook, filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const exts = nb.fileExtensions ?? ['md'];
  if (!exts.includes(ext)) return false;
  return nb.sources.some(s => {
    if (s.type !== 'folder') return false;
    if (s.enabled === false) return false;
    if (s.path === '/' || s.path === '') return true;
    return filePath === s.path || filePath.startsWith(s.path + '/');
  });
}

export default class NotebookAIPlugin extends Plugin {
  private notebookService!: NotebookService;
  private indexService!: IndexService;
  private searchService!: SearchService;
  private summaryService!: SummaryService;
  private eventBus!: IndexerEventBus;
  private observerCleanup: (() => void) | null = null;
  private compactInterval: ReturnType<typeof setInterval> | null = null;
  private providerRegistry!: ProviderRegistry;
  private workerHost: WebWorkerHost | null = null;
  private workerBlobUrl: string | null = null;
  private embeddingRegistry!: EmbeddingClientRegistry;
  private embeddingWorkerHost: EmbeddingWorkerHost | null = null;
  private embeddingWorkerBlobUrl: string | null = null;
  private readonly vectorStores = new Map<string, VectorStore>();
  private folderMarkers: FolderMarkers | null = null;
  private folderMarkersUnsubscribe: (() => void) | null = null;
  private ocrWorkerHost: import('src/extraction/image/ocrWorkerHost').OCRWorkerHost | null = null;
  private ocrStatus: 'not-ready' | 'initializing' | 'ready' | 'error' = 'not-ready';
  private ocrErrorMessage: string | null = null;
  private embeddingDownloadState: 'not-downloaded' | 'downloading' | 'ready' | 'error' = 'not-downloaded';
  private embeddingDownloadProgress = 0;
  private embeddingDownloadError: string | null = null;
  private onnxWasmBytes: Record<string, ArrayBuffer> | null = null;

  async onload(): Promise<void> {
    const onloadStart = performance.now();
    let stageStart = onloadStart;
    const stage = (label: string) => {
      const now = performance.now();
      console.info(`[NotebookAI perf] ${label}: ${Math.round(now - stageStart)}ms (total ${Math.round(now - onloadStart)}ms)`);
      stageStart = now;
    };

    // ── 1. 基础设施 ─────────────────────────────────────────
    const logger = createLogger(this.app.vault.getName());
    this.eventBus = createEventBus<IndexerEventMap>();
    const clock = realClock;
    stage('1. infra');

    // ── 2. Adapters ──────────────────────────────────────────
    const vaultAdapter = new VaultAdapter(this.app.vault);
    const pluginAbsDir = (this.app.vault.adapter as FileSystemAdapter).getBasePath()
      + '/' + this.manifest.dir;
    const dataStore = new DataStoreAdapter(pluginAbsDir);
    const paths = new StoragePaths(pluginAbsDir);

    // ── 3. Storage 初始化 ────────────────────────────────────
    await dataStore.mkdir('notebooks');
    await dataStore.mkdir('indexes');
    await dataStore.mkdir('cache');
    stage('3. mkdirs');

    // ── 4. NotebookService ───────────────────────────────────
    this.notebookService = new NotebookService({ dataStore, paths, clock, logger });
    await this.notebookService.loadAll();
    stage('4. notebookService.loadAll');

    const pluginData = this.notebookService.getPluginData();

    // Initialize i18n as early as possible — every subsequent registration
    // (commands, ribbon labels, settings) reads strings through t().
    setLocale(resolveDefaultLocale(pluginData.ui?.locale));

    // ── 5. HashCache + PathMap 加载 ──────────────────────────
    // 这两个并行加载;hashCache 对大库可达 100+ MB,串行加载浪费 I/O。
    // 加载耗时打日志,方便用户判断是否需要清理/压实。
    const hashCache = new HashCacheStore(dataStore, paths);
    const pathMap = new PathMapStore(dataStore, paths);
    const cacheLoadStart = performance.now();
    await Promise.all([hashCache.load(), pathMap.load()]);
    const cacheLoadMs = Math.round(performance.now() - cacheLoadStart);
    logger.info(`hashCache + pathMap loaded in ${cacheLoadMs}ms`);
    stage('5. hashCache + pathMap');

    // ── 6. ProviderRegistry + TaskResolver ───────────────────
    this.providerRegistry = new ProviderRegistry();
    const makeResolver = () => new TaskResolver(
      this.notebookService.getPluginData().providers,
      this.notebookService.getPluginData().taskAssignments as Record<TaskName, TaskAssignment>,
      this.providerRegistry
    );

    // ── 7. BM25 LRU ──────────────────────────────────────────
    const bm25Lru = new BM25LRU(id => new BM25Store(dataStore, paths, id, CHUNKING_VERSION));

    // ── 8. Reranker Registry ─────────────────────────────────
    const rerankers = new RerankerRegistry();
    rerankers.register({
      name: 'llm',
      rerank: async (query, candidates) => {
        const resolved = makeResolver().resolve('rerank');
        if (!resolved) return candidates.map((c, i) => ({ ...c, finalRank: i }));
        return new LLMReranker(resolved.client, resolved.model).rerank(query, candidates);
      },
    });

    // ── 8.5. EmbeddingClientRegistry + Worker ────────────────────────
    // wasm bytes (19MB) 改为 lazy — 只在启用 local embedding 时才读取。
    // 之前每次启动都强制加载,空跑 1-3 秒 I/O,且占用 19MB 内存。
    this.embeddingRegistry = new EmbeddingClientRegistry();
    this.embeddingWorkerBlobUrl = await this.buildEmbeddingWorkerBlobUrl();
    stage('8.5a. embedding worker blob');
    const pluginDir = (this.app.vault.adapter as FileSystemAdapter).getBasePath()
      + '/' + this.manifest.dir + '/cache/transformers';

    const applyEmbeddingConfig = (cfg: EmbeddingConfig) => {
      this.embeddingRegistry.clear();
      if (!cfg.enabled) return;
      if (cfg.source === 'api' && cfg.apiProviderId && cfg.apiModel) {
        const provider = pluginData.providers.find(p => p.id === cfg.apiProviderId);
        if (provider) {
          this.embeddingRegistry.register(new APIEmbeddingClient({
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: cfg.apiModel,
            providerId: provider.id,
          }));
        }
      } else if (cfg.source === 'local') {
        const modelId = cfg.localModelId ?? 'Xenova/multilingual-e5-small';
        if (!this.embeddingWorkerHost) {
          this.embeddingWorkerHost = new EmbeddingWorkerHost({
            factory: () => new Worker(this.embeddingWorkerBlobUrl!),
            onProgress: (pct) => { this.embeddingDownloadProgress = pct; },
          });
        }
        this.embeddingRegistry.register(new LocalEmbeddingClient({
          host: this.embeddingWorkerHost,
          modelId,
          dimensions: 384,
        }));
        this.embeddingDownloadState = 'downloading';
        this.embeddingDownloadError = null;
        // 把真正启动 worker(读 19MB wasm + 加载 ~110MB transformers 模型 + wasm 编译)
        // 推迟到 layoutReady 之后,避免抢占主线程让 Obsidian UI 卡顿数十秒。
        // 如果 layoutReady 已经触发,立即启动。
        const startInit = () => {
          void (async () => {
            try {
              const wasmBytes = await this.ensureAndCloneWasmBytes();
              await this.embeddingWorkerHost!.init(modelId, pluginDir, wasmBytes);
              this.embeddingDownloadState = 'ready';
              this.embeddingDownloadProgress = 100;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              this.embeddingDownloadState = 'error';
              this.embeddingDownloadError = msg;
              logger.warn(`embedding worker init failed: ${msg}`);
            }
          })();
        };
        if (this.app.workspace.layoutReady) {
          startInit();
        } else {
          this.app.workspace.onLayoutReady(() => setTimeout(startInit, 2000));
        }
      }
    };
    applyEmbeddingConfig(pluginData.embeddingConfig!);
    stage('8.5b. applyEmbeddingConfig (fire-and-forget)');

    // ── 9. IndexService ──────────────────────────────────────
    const extractorRegistry = new ExtractorRegistry();
    extractorRegistry.register(['md', 'txt'], async () =>
      (await import('src/extraction/markdown')).markdownExtractor
    );
    extractorRegistry.register(['docx'], () =>
      import('src/extraction/docx/extractor').then(m => m.docxExtractor)
    );
    extractorRegistry.register(['xlsx'], () =>
      import('src/extraction/xlsx/extractor').then(m => m.xlsxExtractor)
    );
    extractorRegistry.register(['pptx'], () =>
      import('src/extraction/pptx/extractor').then(m => m.pptxExtractor)
    );
    // Main thread uses a stub — the real PDF.js implementation is only loaded
    // inside extractor.worker.js. Importing pdfjs-dist on the main thread runs
    // its top-level `globalThis.pdfjsWorker = {...}` side effect, which clashes
    // with Obsidian's built-in PDF.js (and PDF++). IndexService only reads
    // `extractor.version` on the main thread; the actual extract runs in the
    // worker via workerHost.extract.
    extractorRegistry.register(['pdf'], () =>
      import('src/extraction/pdf/stub').then(m => m.pdfExtractorStub)
    );
    // 预热 cache,让 syncGet 在首次 ensureBM25ForNotebook / scanDiff 调用时命中
    await Promise.all([
      extractorRegistry.get('md'),
      extractorRegistry.get('docx'),
      extractorRegistry.get('xlsx'),
      extractorRegistry.get('pptx'),
      extractorRegistry.get('pdf'),
    ]);
    stage('9a. extractor prewarm');

    this.workerBlobUrl = await this.buildWorkerBlobUrl();
    stage('9b. worker blob');
    this.workerHost = new WebWorkerHost({
      factory: () => new Worker(this.workerBlobUrl!),
    });
    const laneScheduler = new LaneScheduler({
      fastConcurrency: 4,
      slowConcurrency: 1,
      softLimits: SOFT_WARN_BYTES,
    });

    // ── 9.5. ImageExtractor (main-thread route for image files) ──
    this.ocrWorkerHost = new OCRWorkerHost();
    const imageExtractor = makeImageExtractor({
      resolveVisionClient: () => {
        const r = makeResolver().resolve('vision');
        return r ? { client: r.client, model: r.model } : null;
      },
      ocrHost: this.ocrWorkerHost,
      config: () => this.notebookService.getPluginData().imageConfig!,
      logger,
    });

    this.indexService = new IndexService({
      vault: vaultAdapter, dataStore, paths, hashCache, pathMap,
      getBM25: id => bm25Lru.get(id),
      clock, logger, eventBus: this.eventBus,
      notebookStatePort: this.notebookService,
      extractorRegistry,
      platform: { isMobile: Platform.isMobile },
      workerHost: this.workerHost,
      laneScheduler,
      embeddingClient: this.embeddingRegistry.get(),
      onEmbeddingsInvalidated: () => {
        this.vectorStores.clear();
        this.eventBus.emit('embeddings-invalidated', {});
      },
      imageExtractor,
    });

    // ── 10. SearchService ─────────────────────────────────────
    this.searchService = new SearchService({
      hashCache, pathMap,
      getBM25: id => bm25Lru.get(id),
      getNotebook: id => this.notebookService.getNotebook(id),
      reindex: id => this.indexService.reindex(id),
      ensureBM25ForNotebook: id => this.indexService.ensureBM25ForNotebook(id),
      rerankers,
      resolveRerankerName: () => {
        const a = this.notebookService.getPluginData().taskAssignments['rerank'];
        if (!a || a.enabled === false) return undefined;
        return 'llm';
      },
      embeddingRegistry: this.embeddingRegistry,
      getVectorStore: (notebookId) => {
        if (!this.vectorStores.has(notebookId)) {
          this.vectorStores.set(notebookId, new VectorStore());
        }
        return this.vectorStores.get(notebookId)!;
      },
      onVectorStoreInvalidate: (notebookId) => this.vectorStores.delete(notebookId),
    });

    // ── 10.5. SessionStore + ChatService + ArtifactStore + GenerationService ─
    const sessionStore = new SessionStore({ dataStore, paths, clock });
    // SummaryService — 文档级摘要生成 + BM25-over-summary 检索(P2.7)
    this.summaryService = new SummaryService({
      hashCache, pathMap,
      getNotebook: id => this.notebookService.getNotebook(id),
      resolveSummaryClient: () => {
        // 优先 summary 任务的指派;若未配置,fallback 到 chat 任务的指派
        const r = makeResolver().resolve('summary') ?? makeResolver().resolve('chat');
        return r ? { client: r.client, model: r.model } : null;
      },
      logger,
    });

    const chatService = new ChatService({
      searchService: this.searchService,
      resolveTaskClient: () => {
        const r = makeResolver().resolve('chat');
        return r ? { client: r.client, model: r.model } : null;
      },
      getNotebookSystemPrompt: async (id) => {
        const sp = (await this.notebookService.getNotebook(id))?.systemPrompt;
        return sp && sp.trim() ? sp : null;
      },
      hashCache,
      summaryService: this.summaryService,
      clock,
      logger,
    });

    const artifactStore = new ArtifactStore({ dataStore, paths });
    const generationService = new GenerationService({
      hashCache, pathMap,
      getNotebook: id => this.notebookService.getNotebook(id),
      resolveTaskClient: () => {
        const r = makeResolver().resolve('summary');
        return r ? { client: r.client, model: r.model } : null;
      },
      clock,
      logger,
    });

    stage('10. services constructed');

    // ── 11. 启动恢复 ─────────────────────────────────────────
    await this.indexService.recoverAtStartup();
    stage('11. recoverAtStartup');

    // ── 12. Observer 绑定 ─────────────────────────────────────
    // 推迟到 onLayoutReady 之后再注册:Obsidian 工作区加载阶段会从内部触发
    // 大量 vault 事件,如果我们这时已经监听,会被噪音事件淹没,debounce timer
    // 反复重置导致 markDirty 链路反复唤醒,主线程被占。layoutReady 后才有
    // 真实的用户操作,这时再监听更干净。
    this.app.workspace.onLayoutReady(() => {
      this.observerCleanup = createVaultObserver({
        vault: vaultAdapter,
        notebooks: () => this.notebookService.listNotebooks(),
        debounceMs: DIRTY_DEBOUNCE_MS,
        onDirty: ({ notebookIds }) => {
          for (const id of notebookIds) {
            this.indexService.markDirty(id).catch(e => logger.warn(`markDirty failed: ${e}`));
          }
        },
      });
    });

    // ── 13. IndexService 事件同步到 store ────────────────────
    this.eventBus.on('index:dirty-changed', ({ notebookId }) => {
      this.notebookService.getNotebook(notebookId).then(nb => {
        if (nb) useNotebookAIStore.getState().updateNotebook(nb);
      });
    });
    this.eventBus.on('index:complete', ({ notebookId }) => {
      this.notebookService.getNotebook(notebookId).then(nb => {
        if (nb) useNotebookAIStore.getState().updateNotebook(nb);
      });
    });

    // ── 14. Zustand Store 初始化 + vaultFolders 监听 ─────────
    const data = this.notebookService.getPluginData();
    const refreshVaultFolders = () => {
      const folders = (this.app.vault.getAllFolders() as Array<{ path: string }>).map(f => f.path).sort();
      useNotebookAIStore.getState().setVaultFolders(folders);
    };
    useNotebookAIStore.setState({
      providers: data.providers,
      taskAssignments: data.taskAssignments,
      notebooks: this.notebookService.listNotebooks(),
      bannerDismissed: data.diagnostics?.bannerDismissed ?? false,
      activeNotebookId: data.ui?.activeNotebookId,
      vaultFolders: (this.app.vault.getAllFolders() as Array<{ path: string }>).map(f => f.path).sort(),
      // 关键:必须把磁盘里的 embeddingConfig/imageConfig 同步到 store,
      // 否则 SettingsView 读到的是 useStore.ts 里的"假默认值"(enabled:false),
      // 用户在设置页改任何字段时,onConfigChange 会基于这个假值算出 updated,
      // 把 enabled:false 写回磁盘 — 表现为"向量检索自动关闭"。
      embeddingConfig: data.embeddingConfig!,
      imageConfig: data.imageConfig!,
    });
    const isFolder = (f: unknown): boolean =>
      f !== null && typeof f === 'object' && 'children' in f;
    // 同上:推迟到 layoutReady 后再绑 folder 事件,避开工作区加载阶段的事件噪音。
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on('create', f => { if (isFolder(f)) refreshVaultFolders(); }));
      this.registerEvent(this.app.vault.on('rename', f => { if (isFolder(f)) refreshVaultFolders(); }));
      this.registerEvent(this.app.vault.on('delete', f => { if (isFolder(f)) refreshVaultFolders(); }));
    });

    // ── 14.5. File-explorer 已索引文件夹标识 ──────────────────
    this.folderMarkers = new FolderMarkers(this.app);
    this.app.workspace.onLayoutReady(() => {
      this.folderMarkers!.start(useNotebookAIStore.getState().notebooks);
    });
    this.folderMarkersUnsubscribe = useNotebookAIStore.subscribe((state, prev) => {
      if (state.notebooks !== prev.notebooks) {
        this.folderMarkers?.updateFromNotebooks(state.notebooks);
      }
    });

    // ── 15. PluginServices 对象 ───────────────────────────────
    const services: PluginServices = {
      app: this.app,
      testConnection: async (providerId) => {
        const p = this.notebookService.getPluginData().providers.find(x => x.id === providerId);
        if (!p) return { ok: false, latencyMs: 0, error: 'provider not found' };
        const client = this.providerRegistry.getClient(p);
        const start = clock.now();
        try {
          await client.chat({
            messages: [{ role: 'user', content: 'hi' }],
            model: p.defaultModel,
            maxTokens: 1,
          });
          return { ok: true, latencyMs: clock.now() - start };
        } catch (e) {
          return { ok: false, latencyMs: clock.now() - start, error: String(e) };
        }
      },
      reindex: id => this.indexService.reindex(id),
      search: (id, q) => this.searchService.search(id, q),
      eventBus: this.eventBus,

      addProvider: async (draft) => {
        const p = await this.notebookService.addProvider(draft);
        useNotebookAIStore.getState().addProvider(p);
        return p;
      },
      updateProvider: async (p) => {
        await this.notebookService.updateProvider(p);
        this.providerRegistry.invalidate(p.id);
        useNotebookAIStore.getState().updateProvider(p);
      },
      deleteProvider: async (id) => {
        await this.notebookService.deleteProvider(id);
        this.providerRegistry.invalidate(id);
        useNotebookAIStore.getState().removeProvider(id);
      },

      addNotebook: async (name, source) => {
        const nb = await this.notebookService.createNotebook(name, source);
        useNotebookAIStore.getState().addNotebook(nb);
        this.indexService.reindex(nb.id).catch(e => logger.error(`reindex failed: ${e}`));
        return nb;
      },
      updateNotebook: async (id, patch) => {
        const nb = await this.notebookService.updateNotebook(id, { ...patch, status: 'dirty' });
        useNotebookAIStore.getState().updateNotebook(nb);
        this.indexService.reindex(id).catch(e => logger.error(`reindex after update failed: ${e}`));
        return nb;
      },
      deleteNotebook: async (id) => {
        await this.notebookService.deleteNotebook(id);
        useNotebookAIStore.getState().removeNotebook(id);
      },

      setTaskAssignment: async (task, assignment) => {
        await this.notebookService.setTaskAssignment(task, assignment);
        useNotebookAIStore.getState().setTaskAssignments(
          this.notebookService.getPluginData().taskAssignments
        );
      },
      setBannerDismissed: async (v) => {
        const cur = this.notebookService.getPluginData();
        await this.notebookService.savePluginData({
          ...cur,
          diagnostics: { ...(cur.diagnostics ?? {}), bannerDismissed: v },
        });
        useNotebookAIStore.getState().setBannerDismissed(v);
      },

      openChatView: async (notebookId) => {
        useNotebookAIStore.getState().setActiveNotebookId(notebookId);
        const existing = this.app.workspace.getLeavesOfType(NotebookAIChatItemView.VIEW_TYPE);
        const leaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: NotebookAIChatItemView.VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },

      exportIndex: async (notebookId) => {
        if (!notebookId) throw new Error(t('main.error.createNotebookFirst'));
        const raw = await dataStore.read(paths.indexFile(notebookId));
        if (!raw) throw new Error(t('main.error.indexFileMissing'));
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const vaultPath = `notebook-ai-export-${notebookId.slice(0, 8)}-${ts}.json`;
        await this.app.vault.create(vaultPath, raw);
        return { vaultPath };
      },
      clearCache: async () => {
        await dataStore.remove(paths.hashesJsonl);
        await dataStore.remove(paths.pathsJsonl);
        const indexFiles = await dataStore.list(paths.indexesDir);
        for (const f of indexFiles) {
          if (f.endsWith('.msearch.json')) await dataStore.remove(`${paths.indexesDir}/${f}`);
        }
        await hashCache.load();
        await pathMap.load();
        bm25Lru.clear();
        for (const nb of this.notebookService.listNotebooks()) {
          await this.notebookService.persistState(nb.id, { status: 'dirty' });
          const fresh = await this.notebookService.getNotebook(nb.id);
          if (fresh) useNotebookAIStore.getState().updateNotebook(fresh);
        }
      },
      openDevTools: () => {
        const cmds = (this.app as unknown as { commands?: { executeCommandById?: (id: string) => void } }).commands;
        cmds?.executeCommandById?.('app:open-developer-tools');
      },

      chat: (notebookId, history, userText, opts) => chatService.ask(notebookId, history, userText, opts),
      loadActiveSession: async (notebookId) => {
        const nb = await this.notebookService.getNotebook(notebookId);
        if (!nb) throw new Error(`notebook not found: ${notebookId}`);
        if (nb.activeConversationId) {
          const existing = await sessionStore.load(notebookId, nb.activeConversationId);
          if (existing) return existing;
        }
        const fresh = await sessionStore.create(notebookId);
        await this.notebookService.persistState(notebookId, { activeConversationId: fresh.id });
        const updated = await this.notebookService.getNotebook(notebookId);
        if (updated) useNotebookAIStore.getState().updateNotebook(updated);
        return fresh;
      },
      appendTurn: async (notebookId, sessionId, turn) => {
        await sessionStore.appendTurn(notebookId, sessionId, turn);
      },
      openVaultFile: async (filePath, charStart) => {
        const af = this.app.vault.getAbstractFileByPath(filePath);
        if (!af) return;
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(af as TFile);
        if (charStart === undefined) return;
        const view = leaf.view as unknown as { editor?: { getValue(): string; setCursor(pos: { line: number; ch: number }): void; scrollIntoView(range: { from: { line: number; ch: number }; to: { line: number; ch: number } }, center?: boolean): void } };
        const editor = view.editor;
        if (!editor) return;
        const text = editor.getValue();
        const offset = Math.min(Math.max(charStart, 0), text.length);
        const before = text.slice(0, offset);
        const line = (before.match(/\n/g) ?? []).length;
        const lastLF = before.lastIndexOf('\n');
        const ch = lastLF < 0 ? offset : offset - lastLF - 1;
        editor.setCursor({ line, ch });
        editor.scrollIntoView({ from: { line, ch }, to: { line, ch } }, true);
      },

      // wrap 生成流:done 事件触发 ArtifactStore.save 持久化(取消/error 不落盘)
      generate: async function* (notebookId, kind, opts) {
        for await (const ev of generationService.generate(notebookId, kind, opts)) {
          if (ev.type === 'done') {
            await artifactStore.save(ev.artifact);
          }
          yield ev;
        }
      },
      listArtifacts: id => artifactStore.list(id),
      loadArtifact: (id, aid) => artifactStore.load(id, aid),
      deleteArtifact: async (id, aid) => { await artifactStore.delete(id, aid); },
      exportArtifact: async (aid) => {
        for (const nb of this.notebookService.listNotebooks()) {
          const a = await artifactStore.load(nb.id, aid);
          if (!a) continue;
          const slug = a.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
          const ts = new Date(a.generatedAt).toISOString().replace(/[:.]/g, '-');
          const vaultPath = `notebook-ai-${a.kind}-${slug}-${ts}.md`;
          const meta = t('main.exportMeta', {
            time: new Date(a.generatedAt).toLocaleString(),
            model: a.modelUsed,
            truncated: a.truncated ? ' ' + t('main.exportMeta.truncated') : '',
          });
          const md = a.kind === 'ppt'
            ? buildMarpPptMarkdown(meta, a.content)
            : `# ${a.title}\n\n> ${meta}\n\n${a.content}\n`;
          await this.app.vault.create(vaultPath, md);
          return { vaultPath };
        }
        throw new Error('artifact not found');
      },

      fetchChunksForFile: async (filePath, notebookId) => {
        const nb = useNotebookAIStore.getState().notebooks.find(n => n.id === notebookId);
        if (!nb || !notebookCoversFile(nb, filePath)) return null;
        const entry = pathMap.get(filePath);
        if (!entry) return null;
        const cached = hashCache.get(entry.fileHash);
        if (!cached || cached.status !== 'ok') return null;
        return { chunks: cached.chunks, fileHash: entry.fileHash };
      },
      invalidateFileHash: async (filePath) => {
        const entry = pathMap.get(filePath);
        if (!entry) return;
        hashCache.invalidate(entry.fileHash);
        const owners = useNotebookAIStore.getState().notebooks.filter(nb => notebookCoversFile(nb, filePath));
        for (const nb of owners) {
          await this.indexService.markDirty(nb.id);
        }
      },
      openChunksInspector: (filePath, notebookId) => {
        new ChunksInspectorModal(this.app, filePath, notebookId, services).open();
      },

      saveEmbeddingConfig: async (cfg) => {
        const cur = this.notebookService.getPluginData();
        await this.notebookService.savePluginData({ ...cur, embeddingConfig: cfg });
        useNotebookAIStore.getState().setEmbeddingConfig(cfg);
        applyEmbeddingConfig(cfg);
      },
      downloadEmbeddingModel: () => {
        const cfg = this.notebookService.getPluginData().embeddingConfig;
        if (!cfg?.enabled || cfg.source !== 'local') return;
        const modelId = cfg.localModelId ?? 'Xenova/multilingual-e5-small';
        if (!this.embeddingWorkerHost) {
          this.embeddingWorkerHost = new EmbeddingWorkerHost({
            factory: () => new Worker(this.embeddingWorkerBlobUrl!),
            onProgress: (pct) => { this.embeddingDownloadProgress = pct; },
          });
        }
        if (this.embeddingDownloadState === 'downloading') {
          new Notice(t('main.model.alreadyDownloading'));
          return;
        }
        if (this.embeddingDownloadState === 'ready') {
          new Notice(t('main.model.ready'));
          return;
        }
        this.embeddingDownloadState = 'downloading';
        this.embeddingDownloadProgress = 0;
        this.embeddingDownloadError = null;
        void (async () => {
          try {
            const wasmBytes = await this.ensureAndCloneWasmBytes();
            await this.embeddingWorkerHost!.init(modelId, pluginDir, wasmBytes);
            this.embeddingDownloadState = 'ready';
            this.embeddingDownloadProgress = 100;
            new Notice(t('main.model.downloadComplete'));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.embeddingDownloadState = 'error';
            this.embeddingDownloadError = msg;
            logger.warn(`model download failed: ${msg}`);
            new Notice(t('main.model.downloadFailed', { error: msg }));
          }
        })();
      },
      getEmbeddingDownloadState: () => this.embeddingDownloadState,
      getEmbeddingDownloadProgress: () => this.embeddingDownloadProgress,
      getEmbeddingDownloadError: () => this.embeddingDownloadError,
      triggerFullReindex: () => triggerReindexAll(),
      backfillSummaries: (notebookId, opts) => {
        const ctrl = new AbortController();
        const promise = this.summaryService.backfill(notebookId, {
          signal: ctrl.signal,
          concurrency: opts?.concurrency ?? 1,
          onProgress: (p) => {
            this.eventBus.emit('summary:progress', p);
          },
        });
        return { cancel: () => ctrl.abort(), promise };
      },
      getSummaryCoverage: (notebookId) => this.summaryService.coverage(notebookId),
      setLocale: async (locale) => {
        const cur = this.notebookService.getPluginData();
        await this.notebookService.savePluginData({
          ...cur,
          ui: { ...(cur.ui ?? {}), locale },
        });
        setLocale(locale);
        new Notice(t('settings.languageChangedReloadRequired'));
      },
      getEmbeddingCoverage: () => {
        const currentModelId = this.embeddingRegistry.get()?.modelId;
        let total = 0;
        let embedded = 0;
        let failedFiles = 0;
        let chunksFromOtherModels = 0;
        for (const entry of hashCache.aliveEntries()) {
          if (entry.status !== 'ok') continue;
          const fileChunkCount = entry.chunks.length;
          total += fileChunkCount;
          if (entry.embeddingError) failedFiles++;
          if (!entry.embeddings || !entry.embeddingModelId) continue;
          if (entry.embeddingModelId === currentModelId) {
            embedded += Object.keys(entry.embeddings).length;
          } else {
            chunksFromOtherModels += Object.keys(entry.embeddings).length;
          }
        }
        const outdated = !!currentModelId && embedded === 0 && chunksFromOtherModels > 0;
        return { total, embedded, failed: failedFiles, outdated };
      },
      saveImageConfig: async (cfg) => {
        const cur = this.notebookService.getPluginData();
        await this.notebookService.savePluginData({ ...cur, imageConfig: cfg });
        useNotebookAIStore.getState().setImageConfig(cfg);
      },
      getOcrStatus: () => this.ocrStatus,
      getOcrErrorMessage: () => this.ocrErrorMessage,
      initOcr: () => {
        if (this.ocrStatus === 'initializing' || this.ocrStatus === 'ready') return;
        const cfg = this.notebookService.getPluginData().imageConfig;
        if (!cfg?.ocrEnabled || !this.ocrWorkerHost) {
          this.ocrErrorMessage = t('main.ocr.notReady');
          this.ocrStatus = 'error';
          return;
        }
        this.ocrStatus = 'initializing';
        this.ocrErrorMessage = null;
        // Note: cachePath is Node-only in tesseract.js v6+; in browser/Electron it caches
        // via IndexedDB automatically. Passing it can cause init failures.
        void this.ocrWorkerHost.init(cfg.ocrLangs)
          .then(() => { this.ocrStatus = 'ready'; this.ocrErrorMessage = null; })
          .catch(e => {
            const msg = e instanceof Error ? `${e.message}${e.stack ? '\n' + e.stack.split('\n').slice(0, 3).join('\n') : ''}` : String(e);
            logger.warn(`OCR init failed: ${msg}`);
            console.error('[NotebookAI] OCR init full error:', e);
            this.ocrStatus = 'error';
            this.ocrErrorMessage = msg;
          });
      },
      saveTurnAsNote: async (notebookId, turnId) => {
        const nb = await this.notebookService.getNotebook(notebookId);
        if (!nb) throw new Error(`notebook not found: ${notebookId}`);
        if (!nb.activeConversationId) throw new Error('no active conversation');
        const session = await sessionStore.load(notebookId, nb.activeConversationId);
        if (!session) throw new Error('session not found');
        const turnIdx = session.turns.findIndex(t => t.id === turnId);
        if (turnIdx < 0) throw new Error(`turn not found: ${turnId}`);
        const turn = session.turns[turnIdx];
        if (turn.role !== 'assistant') throw new Error('turn must be assistant');
        let userQuestion = '';
        for (let i = turnIdx - 1; i >= 0; i--) {
          if (session.turns[i].role === 'user') {
            userQuestion = session.turns[i].content;
            break;
          }
        }
        const now = new Date();
        const filename = buildNoteFilename(userQuestion, now);
        const content = buildNoteMarkdown({
          userQuestion,
          assistantContent: turn.content,
          notebookName: nb.name,
          timestamp: now,
          citations: turn.citations ?? [],
        });

        const firstSource = nb.sources[0];
        const targetDir = (firstSource && firstSource.type === 'folder' && firstSource.path)
          ? firstSource.path
          : '';
        if (targetDir) {
          const dirExists = !!this.app.vault.getAbstractFileByPath(targetDir);
          if (!dirExists) await this.app.vault.createFolder(targetDir);
        }
        let candidate = targetDir ? `${targetDir}/${filename}` : filename;
        if (this.app.vault.getAbstractFileByPath(candidate)) {
          const stem = filename.slice(0, -3);
          for (let n = 2; n < 1000; n++) {
            const alt = targetDir ? `${targetDir}/${stem} (${n}).md` : `${stem} (${n}).md`;
            if (!this.app.vault.getAbstractFileByPath(alt)) { candidate = alt; break; }
          }
        }
        await this.app.vault.create(candidate, content);
        new Notice(t('chat.savedTo', { path: candidate }));
        return { vaultPath: candidate };
      },
    };

    // ── 16. Ribbon + Commands + file-menu 监听 ───────────────

    // Helper:fire-and-forget 全库重索引(I5 修正,不要串行 await,免得 UI 卡死)
    const triggerReindexAll = () => {
      const ids = useNotebookAIStore.getState().notebooks.map(n => n.id);
      for (const id of ids) {
        this.indexService.reindex(id).catch(e => logger.warn(`reindex ${id} failed: ${e}`));
      }
      new Notice(t('main.reindexTriggered', { count: ids.length }));
    };

    // Helper:从 ribbon / command 触发"打开主视图"
    const openMainView = () => {
      const activeId = useNotebookAIStore.getState().activeNotebookId;
      const firstId = useNotebookAIStore.getState().notebooks[0]?.id;
      const targetId = activeId ?? firstId;
      if (!targetId) {
        new Notice(t('main.error.createNotebookFirst'));
        return;
      }
      services.openChatView(targetId).catch(e => logger.error(`openChatView: ${e}`));
    };

    // Ribbon icon
    const ribbonEl = this.addRibbonIcon('book-marked', t('plugin.name'), () => openMainView());

    // I6 修正:用 registerDomEvent 让 Obsidian 在 unload 时自动清理 listener
    this.registerDomEvent(ribbonEl, 'contextmenu', (evt) => {
      evt.preventDefault();
      showRibbonContextMenu(evt, {
        services,
        getNotebooks: () => useNotebookAIStore.getState().notebooks,
        getActiveNotebookId: () => useNotebookAIStore.getState().activeNotebookId,
        setActiveNotebookId: (id) => useNotebookAIStore.getState().setActiveNotebookId(id),
        reindexAll: () => triggerReindexAll(),
        openSettings: () => {
          // Obsidian Settings 打开 + 跳到本插件 tab(可能未声明 setting.openTabById,做容错)
          const setting = (this.app as any).setting;
          if (setting?.open) setting.open();
          if (setting?.openTabById && this.manifest?.id) setting.openTabById(this.manifest.id);
        },
      });
    });

    // 全库重索引 command(沿用 fire-and-forget)
    this.addCommand({
      id: 'reindex-all-notebooks',
      name: t('plugin.command.reindexAll'),
      callback: () => triggerReindexAll(),
    });

    // 注册 file-menu 监听(folder 与 file 共用一个事件)
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFolder) {
        attachFolderContextMenu(menu, file, {
          app: this.app,
          services,
          getNotebooks: () => useNotebookAIStore.getState().notebooks,
        });
      } else if (file instanceof TFile) {
        attachFileContextMenu(menu, file, {
          services,
          getNotebooks: () => useNotebookAIStore.getState().notebooks,
          getActiveNotebookId: () => useNotebookAIStore.getState().activeNotebookId,
        });
      }
    }));

    // ── 17. SettingsTab 注册 ──────────────────────────────────
    this.addSettingTab(new NotebookAISettingTab(this.app, this, services));

    // ── 18. ItemView 注册 ─────────────────────────────────────
    this.registerView(
      NotebookAIChatItemView.VIEW_TYPE,
      leaf => new NotebookAIChatItemView(leaf, services)
    );

    // ── 19. 命令注册 ──────────────────────────────────────────
    this.addCommand({
      id: 'reindex-active-notebook',
      name: t('plugin.command.reindexActive'),
      callback: () => {
        const id = useNotebookAIStore.getState().activeNotebookId;
        if (id) this.indexService.reindex(id).catch(e => logger.error(`reindex error: ${e}`));
      },
    });

    // ── 20. maybeCompact 定时器 ───────────────────────────────
    this.compactInterval = setInterval(() => {
      this.indexService.maybeCompact().catch(e => logger.warn(`compact error: ${e}`));
    }, COMPACT_INTERVAL_MS);

    stage('final. NotebookAI loaded');
    const onloadDoneAt = performance.now();
    logger.info(`NotebookAI fully loaded in ${Math.round(onloadDoneAt - onloadStart)}ms`);
    this.app.workspace.onLayoutReady(() => {
      console.info(`[NotebookAI perf] onLayoutReady fired: ${Math.round(performance.now() - onloadDoneAt)}ms after onload completed`);
    });
  }

  async onunload(): Promise<void> {
    await this.workerHost?.shutdown();
    this.workerHost = null;
    if (this.workerBlobUrl) {
      URL.revokeObjectURL(this.workerBlobUrl);
      this.workerBlobUrl = null;
    }
    void this.embeddingWorkerHost?.shutdown();
    this.embeddingWorkerHost = null;
    void this.ocrWorkerHost?.shutdown();
    this.ocrWorkerHost = null;
    this.ocrStatus = 'not-ready';
    if (this.embeddingWorkerBlobUrl) {
      URL.revokeObjectURL(this.embeddingWorkerBlobUrl);
      this.embeddingWorkerBlobUrl = null;
    }
    this.onnxWasmBytes = null;
    this.observerCleanup?.();
    this.observerCleanup = null;
    this.folderMarkersUnsubscribe?.();
    this.folderMarkersUnsubscribe = null;
    this.folderMarkers?.stop();
    this.folderMarkers = null;
    if (this.compactInterval) {
      clearInterval(this.compactInterval);
      this.compactInterval = null;
    }
    console.log('[NotebookAI] unloaded');
  }

  private async buildWorkerBlobUrl(): Promise<string> {
    const dir = this.manifest.dir!;
    const adapter = this.app.vault.adapter;
    const workerSource = await adapter.read(`${dir}/extractor.worker.js`);
    const blob = new Blob([workerSource], { type: 'text/javascript' });
    return URL.createObjectURL(blob);
  }

  private async buildEmbeddingWorkerBlobUrl(): Promise<string> {
    const dir = this.manifest.dir!;
    const adapter = this.app.vault.adapter;
    const workerSource = await adapter.read(`${dir}/embedding.worker.js`);
    const blob = new Blob([workerSource], { type: 'text/javascript' });
    return URL.createObjectURL(blob);
  }

  /**
   * Lazy-load the onnxruntime-web wasm files (~19MB) on first use, then clone
   * for postMessage transfer. Avoids the cost on every startup — previously
   * all users paid 1-3s of I/O even if they never enabled local embeddings.
   */
  private async ensureAndCloneWasmBytes(): Promise<Record<string, ArrayBuffer>> {
    if (!this.onnxWasmBytes) {
      this.onnxWasmBytes = await this.loadOnnxWasmBytes();
    }
    const out: Record<string, ArrayBuffer> = {};
    for (const [k, buf] of Object.entries(this.onnxWasmBytes)) {
      out[k] = buf.slice(0);
    }
    return out;
  }

  private async loadOnnxWasmBytes(): Promise<Record<string, ArrayBuffer>> {
    const dir = this.manifest.dir!;
    const adapter = this.app.vault.adapter;
    const out: Record<string, ArrayBuffer> = {};
    for (const f of ['ort-wasm.wasm', 'ort-wasm-simd.wasm']) {
      out[f] = await adapter.readBinary(`${dir}/${f}`);
    }
    return out;
  }

  search(notebookId: string, query: string): Promise<SearchHit[]> {
    return this.searchService.search(notebookId, query);
  }
}

class NotebookAISettingTab extends PluginSettingTab {
  private root: import('react-dom/client').Root | null = null;

  constructor(
    app: ObsidianApp,
    plugin: NotebookAIPlugin,
    private readonly services: PluginServices
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.root = createRoot(this.containerEl);
    this.root.render(
      React.createElement(React.StrictMode, null,
        React.createElement(App, { services: this.services })
      )
    );
  }

  hide(): void {
    this.root?.unmount();
    this.root = null;
  }
}

class NotebookAIChatItemView extends ItemView {
  static readonly VIEW_TYPE = 'notebook-ai-chat';
  private root: import('react-dom/client').Root | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly services: PluginServices) {
    super(leaf);
  }

  getViewType(): string { return NotebookAIChatItemView.VIEW_TYPE; }
  getDisplayText(): string { return t('main.viewDisplayText'); }
  getIcon(): string { return 'message-square'; }

  async onOpen(): Promise<void> {
    this.root = createRoot(this.containerEl.children[1]);
    this.root.render(
      React.createElement(PluginServicesContext.Provider, { value: this.services },
        React.createElement(ChatView, null)
      )
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}

/**
 * 构造 Marp 幻灯片 markdown:
 * - frontmatter 含 inline style(手写感字体 + 圆角彩色装饰)
 * - 元信息以 HTML 注释隐藏(不渲染为页面),让 LLM 输出的封面是唯一封面
 * - CSS 兼容 Obsidian Marp 插件,无外部依赖
 */
function buildMarpPptMarkdown(meta: string, content: string): string {
  const style = `
section {
  font-family: 'Kaiti', '楷体', 'KaiTi', 'STKaiti', 'Comic Sans MS', cursive;
  background: linear-gradient(135deg, #fefdf7 0%, #fdfaf0 100%);
  color: #2d2a26;
  padding: 60px 70px;
}
section.lead {
  text-align: center;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
}
section.lead h1 {
  font-size: 2.6em;
  color: #92400e;
  border: none;
}
h1 {
  color: #2563eb;
  border-bottom: 3px dashed #fbbf24;
  padding-bottom: 12px;
  font-weight: 700;
}
h2 {
  color: #7c3aed;
  border-left: 6px solid #f59e0b;
  padding-left: 14px;
}
h3 { color: #059669; }
strong { color: #dc2626; background: #fef9c3; padding: 0 4px; border-radius: 3px; }
ul li::marker { color: #f59e0b; font-size: 1.2em; }
ol li::marker { color: #2563eb; font-weight: bold; }
blockquote {
  border-left: 5px solid #a78bfa;
  background: #f5f3ff;
  padding: 12px 18px;
  border-radius: 0 8px 8px 0;
  font-style: normal;
}
code {
  background: #fef3c7;
  color: #92400e;
  padding: 2px 6px;
  border-radius: 4px;
}
.columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
section::after {
  color: #a78bfa;
  font-size: 0.8em;
}
a { color: #2563eb; text-decoration: none; border-bottom: 1px dotted #2563eb; }
/* mermaid 图表手绘风容器 */
.mermaid {
  font-family: 'Kaiti', '楷体', 'Comic Sans MS', cursive !important;
  text-align: center;
}
.mermaid svg { max-height: 60vh !important; }
`.trim();

  // mermaid handDrawn look 配置(v10+ 支持),Obsidian 渲染 mermaid 时读取
  // 此 init 会被 markdown 内首个 ~~~mermaid 块前注入识别
  const mermaidInit = '%%{init: {"theme": "neutral", "look": "handDrawn", ' +
    '"handDrawnSeed": 1, "themeVariables": {"fontFamily": "Kaiti, 楷体, Comic Sans MS, cursive"}} }%%';

  // 在每个 mermaid 代码块开头自动注入 init 配置(若 LLM 没加),实现整 deck 手绘风
  const contentWithMermaidInit = content.replace(
    /```mermaid\n(?!%%\{init)/g,
    '```mermaid\n' + mermaidInit + '\n'
  );

  return [
    '---',
    'marp: true',
    'theme: default',
    'paginate: true',
    'style: |',
    ...style.split('\n').map(l => '  ' + l),
    '---',
    '',
    `<!-- ${meta} -->`,
    '',
    contentWithMermaidInit,
    '',
  ].join('\n');
}
