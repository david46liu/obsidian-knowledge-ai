import React, { useState, useEffect } from 'react';
import type { Provider, Source, Notebook, NotebookId } from 'src/types/data';
import { useNotebookAIStore } from 'src/ui/hooks/useStore';
import { usePluginServices } from 'src/ui/hooks/useStore';
import { EmbeddingSection, type VectorCoverage } from 'src/ui/components/EmbeddingSection';
import { ImageSection } from 'src/ui/components/ImageSection';
import { ProviderCard } from 'src/ui/components/ProviderCard';
import { NotebookCard } from 'src/ui/components/NotebookCard';
import { TaskAssignmentPanel } from 'src/ui/components/TaskAssignmentPanel';
import { FolderPicker } from 'src/ui/components/FolderPicker';
import { OfficeFormatPicker } from 'src/ui/components/OfficeFormatPicker';
import { OfficeOptionsPanel } from 'src/ui/components/OfficeOptionsPanel';
import {
  type NotebookOptionsState,
  initialOptionsState,
  setOfficeOptions,
} from 'src/ui/notebookOptionsReducer';

export function SettingsView() {
  const {
    providers, taskAssignments, notebooks, bannerDismissed, vaultFolders, embeddingConfig, imageConfig,
  } = useNotebookAIStore();
  const services = usePluginServices();

  const [showProviderForm, setShowProviderForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showNotebookForm, setShowNotebookForm] = useState(false);
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [coverage, setCoverage] = useState<VectorCoverage | null>(null);
  const [embDlState, setEmbDlState] = useState<'not-downloaded' | 'downloading' | 'ready' | 'error'>('not-downloaded');
  const [embDlProgress, setEmbDlProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState<'not-ready' | 'initializing' | 'ready' | 'error'>('not-ready');

  useEffect(() => {
    const refresh = () => {
      const fn = services.getEmbeddingCoverage;
      setCoverage(fn ? fn() : { total: 0, embedded: 0, failed: 0, outdated: false });
      setEmbDlState(services.getEmbeddingDownloadState?.() ?? 'not-downloaded');
      setEmbDlProgress(services.getEmbeddingDownloadProgress?.() ?? 0);
      setOcrStatus(services.getOcrStatus?.() ?? 'not-ready');
    };
    refresh();
    const offInvalidated = services.eventBus.on('embeddings-invalidated', refresh);
    const offComplete = services.eventBus.on('index:complete', refresh);
    // Poll every 500ms while download/OCR init is in flight
    const interval = setInterval(refresh, 500);
    return () => { offInvalidated(); offComplete(); clearInterval(interval); };
  }, [services, embeddingConfig]);

  // Provider form state
  const [providerDraft, setProviderDraft] = useState({
    displayName: '', baseUrl: '', apiKey: '', defaultModel: '', timeoutMs: 30000,
    supportsEmbeddings: false,
    supportsVision: false,
  });

  // Notebook form state
  const [notebookDraft, setNotebookDraft] = useState({
    name: '', folder: '', recursive: true, excludeGlobs: '', systemPrompt: '',
  });
  const [optionsState, setOptionsState] = useState<NotebookOptionsState>(
    initialOptionsState({ fileExtensions: undefined, officeOptions: undefined })
  );

  const handleAddProvider = async () => {
    if (!providerDraft.displayName || !providerDraft.baseUrl) return;
    await services.addProvider({
      displayName: providerDraft.displayName,
      kind: 'openai-compatible',
      baseUrl: providerDraft.baseUrl,
      apiKey: providerDraft.apiKey,
      defaultModel: providerDraft.defaultModel,
      timeoutMs: providerDraft.timeoutMs,
      capabilities: {
        supportsJsonMode: true,
        supportsStreaming: true,
        supportsTools: true,
        supportsTemperature: true,
        supportsMaxTokens: true,
        maxTokensFieldName: 'max_tokens',
        supportsEmbeddings: providerDraft.supportsEmbeddings,
        supportsVision: providerDraft.supportsVision,
      },
    });
    setProviderDraft({ displayName: '', baseUrl: '', apiKey: '', defaultModel: '', timeoutMs: 30000, supportsEmbeddings: false, supportsVision: false });
    setShowProviderForm(false);
  };

  const handleEditProvider = (p: Provider) => {
    setEditingProvider(p);
    setProviderDraft({
      displayName: p.displayName,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      defaultModel: p.defaultModel,
      timeoutMs: p.timeoutMs,
      supportsEmbeddings: p.capabilities.supportsEmbeddings ?? false,
      supportsVision: p.capabilities.supportsVision ?? false,
    });
    setShowProviderForm(true);
  };

  const handleUpdateProvider = async () => {
    if (!editingProvider) return;
    const updated: Provider = {
      ...editingProvider,
      displayName: providerDraft.displayName,
      baseUrl: providerDraft.baseUrl,
      apiKey: providerDraft.apiKey,
      defaultModel: providerDraft.defaultModel,
      timeoutMs: providerDraft.timeoutMs,
      capabilities: { ...editingProvider.capabilities, supportsEmbeddings: providerDraft.supportsEmbeddings, supportsVision: providerDraft.supportsVision },
      updatedAt: Date.now(),
    };
    await services.updateProvider(updated);
    setEditingProvider(null);
    setShowProviderForm(false);
  };

  const handleDeleteProvider = (id: string) => {
    services.deleteProvider(id);
  };

  const parseExcludeGlobs = (raw: string): string[] => {
    return raw.split('\n').map(s => s.trim()).filter(Boolean);
  };

  const handleAddNotebook = async () => {
    if (!notebookDraft.name || !notebookDraft.folder) return;
    const excludeGlobs = parseExcludeGlobs(notebookDraft.excludeGlobs);
    const source: Source = {
      id: '',
      type: 'folder',
      path: notebookDraft.folder,
      recursive: notebookDraft.recursive,
      ...(excludeGlobs.length > 0 ? { excludeGlobs } : {}),
    };
    // C4: services.addNotebook returns Promise<Notebook>
    const nb = await services.addNotebook(notebookDraft.name, source);
    await services.updateNotebook(nb.id, {
      fileExtensions: optionsState.fileExtensions,
      officeOptions: optionsState.officeOptions,
    });
    setNotebookDraft({ name: '', folder: '', recursive: true, excludeGlobs: '', systemPrompt: '' });
    setOptionsState(initialOptionsState({ fileExtensions: undefined, officeOptions: undefined }));
    setShowNotebookForm(false);
  };

  const handleEditNotebook = (nb: Notebook) => {
    setEditingNotebook(nb);
    const src = nb.sources[0];
    setNotebookDraft({
      name: nb.name,
      folder: src?.path ?? '',
      recursive: src?.recursive ?? true,
      excludeGlobs: (src?.excludeGlobs ?? []).join('\n'),
      systemPrompt: nb.systemPrompt ?? '',
    });
    setOptionsState(initialOptionsState({
      fileExtensions: nb.fileExtensions,
      officeOptions: nb.officeOptions,
    }));
    setShowNotebookForm(true);
  };

  const handleUpdateNotebook = async () => {
    if (!editingNotebook) return;
    const excludeGlobs = parseExcludeGlobs(notebookDraft.excludeGlobs);
    const src = editingNotebook.sources[0];
    const updatedSource: Source = {
      id: src?.id ?? '',
      type: 'folder',
      path: notebookDraft.folder,
      recursive: notebookDraft.recursive,
      ...(excludeGlobs.length > 0 ? { excludeGlobs } : {}),
    };
    await services.updateNotebook(editingNotebook.id, {
      name: notebookDraft.name,
      sources: [updatedSource],
      systemPrompt: notebookDraft.systemPrompt,
      fileExtensions: optionsState.fileExtensions,
      officeOptions: optionsState.officeOptions,
    });
    setEditingNotebook(null);
    setNotebookDraft({ name: '', folder: '', recursive: true, excludeGlobs: '', systemPrompt: '' });
    setOptionsState(initialOptionsState({ fileExtensions: undefined, officeOptions: undefined }));
    setShowNotebookForm(false);
  };

  const handleDeleteNotebook = (id: NotebookId) => {
    services.deleteNotebook(id);
  };

  const handleReindex = (id: NotebookId) => {
    services.reindex(id).catch(() => { /* errors surface via eventBus */ });
  };

  const handleOpenNotebook = (id: NotebookId) => {
    services.openChatView(id);
  };

  const handleTaskChange = (task: import('src/types/data').TaskName, assignment: import('src/types/data').TaskAssignment | null) => {
    services.setTaskAssignment(task, assignment);
  };

  return (
    <div style={{ padding: '16px' }}>
      {/* Section 1: Banner */}
      {!bannerDismissed && (
        <div style={{
          background: 'var(--background-modifier-error)',
          padding: '8px 12px',
          borderRadius: '4px',
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>⚠️ API Key 以明文形式存储在插件数据目录中。请勿在共享设备上使用。</span>
          <button onClick={() => services.setBannerDismissed(true)}>关闭</button>
        </div>
      )}

      {/* Section 2: API Providers */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ margin: 0 }}>API 服务商</h3>
          <button onClick={() => { setEditingProvider(null); setShowProviderForm(!showProviderForm); }}>
            {showProviderForm ? '取消' : '添加'}
          </button>
        </div>

        {showProviderForm && (
          <div style={{ border: '1px solid var(--background-modifier-border)', padding: '12px', borderRadius: '4px', marginBottom: '8px' }}>
            <div style={{ marginBottom: '8px' }}>
              <label>名称</label>
              <input type="text" value={providerDraft.displayName} onChange={e => setProviderDraft(d => ({ ...d, displayName: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label>Base URL</label>
              <input type="text" value={providerDraft.baseUrl} onChange={e => setProviderDraft(d => ({ ...d, baseUrl: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label>API Key</label>
              <input type="password" value={providerDraft.apiKey} onChange={e => setProviderDraft(d => ({ ...d, apiKey: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label>默认模型</label>
              <input type="text" value={providerDraft.defaultModel} onChange={e => setProviderDraft(d => ({ ...d, defaultModel: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label>超时 (ms)</label>
              <input type="number" value={providerDraft.timeoutMs} onChange={e => setProviderDraft(d => ({ ...d, timeoutMs: Number(e.target.value) }))} style={{ width: '100%' }} />
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                id="provider-supports-embeddings"
                type="checkbox"
                checked={providerDraft.supportsEmbeddings}
                onChange={e => setProviderDraft(d => ({ ...d, supportsEmbeddings: e.target.checked }))}
              />
              <label htmlFor="provider-supports-embeddings" style={{ cursor: 'pointer' }}>
                支持 Embedding
                <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  勾选后此 provider 会出现在向量检索的来源列表中
                </span>
              </label>
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                id="provider-supports-vision"
                type="checkbox"
                checked={providerDraft.supportsVision}
                onChange={e => setProviderDraft(d => ({ ...d, supportsVision: e.target.checked }))}
              />
              <label htmlFor="provider-supports-vision" style={{ cursor: 'pointer' }}>
                支持 Vision
                <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  勾选后此 provider 可被用作图片索引的视觉理解任务
                </span>
              </label>
            </div>
            <button onClick={editingProvider ? handleUpdateProvider : handleAddProvider}>
              {editingProvider ? '保存' : '添加'}
            </button>
          </div>
        )}

        {providers.map(p => (
          <ProviderCard
            key={p.id}
            provider={p}
            onEdit={handleEditProvider}
            onDelete={handleDeleteProvider}
            onTestConnection={services.testConnection}
          />
        ))}
      </div>

      {/* Section 3: Task Model Assignment */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ margin: 0, marginBottom: '8px' }}>任务模型分配</h3>
        <TaskAssignmentPanel
          providers={providers}
          taskAssignments={taskAssignments}
          onChange={handleTaskChange}
          advanced={advanced}
          onToggleAdvanced={() => setAdvanced(a => !a)}
        />
      </div>

      {/* Section 4: Vector Retrieval */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ margin: 0, marginBottom: '8px' }}>向量检索</h3>
        <EmbeddingSection
          config={embeddingConfig}
          providers={providers}
          coverage={coverage}
          modelDownloadState={embDlState}
          downloadProgress={embDlProgress}
          downloadError={services.getEmbeddingDownloadError?.() ?? null}
          onConfigChange={async (patch) => {
            const updated = { ...embeddingConfig, ...patch };
            await services.saveEmbeddingConfig?.(updated);
            useNotebookAIStore.getState().setEmbeddingConfig(updated);
          }}
          onDownloadModel={() => services.downloadEmbeddingModel?.()}
          onTriggerReindex={() => services.triggerFullReindex?.()}
        />
      </div>

      {/* Section 4.5: Image Indexing */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ margin: 0, marginBottom: '8px' }}>图片索引</h3>
        <ImageSection
          config={imageConfig}
          ocrStatus={ocrStatus}
          ocrErrorMessage={services.getOcrErrorMessage?.() ?? null}
          onConfigChange={async (patch) => {
            const updated = { ...imageConfig, ...patch };
            await services.saveImageConfig?.(updated);
            useNotebookAIStore.getState().setImageConfig(updated);
          }}
          onInitOcr={() => services.initOcr?.()}
        />
      </div>

      {/* Section 5: Notebooks */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ margin: 0 }}>Notebooks</h3>
          <button onClick={() => {
            if (showNotebookForm) {
              setShowNotebookForm(false);
              setEditingNotebook(null);
              setNotebookDraft({ name: '', folder: '', recursive: true, excludeGlobs: '', systemPrompt: '' });
              setOptionsState(initialOptionsState({ fileExtensions: undefined, officeOptions: undefined }));
            } else {
              setEditingNotebook(null);
              setNotebookDraft({ name: '', folder: '', recursive: true, excludeGlobs: '', systemPrompt: '' });
              setOptionsState(initialOptionsState({ fileExtensions: undefined, officeOptions: undefined }));
              setShowNotebookForm(true);
            }
          }}>
            {showNotebookForm ? '取消' : '新建'}
          </button>
        </div>

        {showNotebookForm && (
          <div style={{ border: '1px solid var(--background-modifier-border)', padding: '12px', borderRadius: '4px', marginBottom: '8px' }}>
            <div style={{ marginBottom: '8px' }}>
              <label>名称</label>
              <input type="text" value={notebookDraft.name} onChange={e => setNotebookDraft(d => ({ ...d, name: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label>文件夹</label>
              <FolderPicker
                value={notebookDraft.folder}
                folders={vaultFolders}
                onChange={f => setNotebookDraft(d => ({ ...d, folder: f }))}
              />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label>
                <input
                  type="checkbox"
                  checked={notebookDraft.recursive}
                  onChange={e => setNotebookDraft(d => ({ ...d, recursive: e.target.checked }))}
                />
                {' '}包含子文件夹
              </label>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label>排除规则（每行一条；支持 <code>**/x</code> / <code>prefix*</code> / <code>*.ext</code> / 精确路径）</label>
              <textarea
                value={notebookDraft.excludeGlobs}
                onChange={e => setNotebookDraft(d => ({ ...d, excludeGlobs: e.target.value }))}
                placeholder={'示例：\n**/templates/**\n**/_*.md\n*.tmp'}
                rows={4}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label>System Prompt（可选；指导 AI 回答风格，留空使用默认）</label>
              <textarea
                value={notebookDraft.systemPrompt}
                onChange={e => setNotebookDraft(d => ({ ...d, systemPrompt: e.target.value }))}
                placeholder={'示例：你是一名严谨的技术编辑助手，回答简洁专业，引用资料时务必标 [N]。'}
                rows={4}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
            </div>
            <OfficeFormatPicker
              value={optionsState.fileExtensions}
              onChange={next => {
                // If pptx was removed and notes were on, auto-clear notes
                const wasPptx = optionsState.fileExtensions.includes('pptx');
                const stillPptx = next.includes('pptx');
                if (wasPptx && !stillPptx && optionsState.officeOptions.includePptxNotes) {
                  setOptionsState({
                    fileExtensions: next,
                    officeOptions: { ...optionsState.officeOptions, includePptxNotes: false },
                  });
                } else {
                  setOptionsState(s => ({ ...s, fileExtensions: next }));
                }
              }}
            />
            <OfficeOptionsPanel
              value={optionsState.officeOptions}
              fileExtensions={optionsState.fileExtensions}
              onChange={next => setOptionsState(s => setOfficeOptions(s, next))}
            />
            <button onClick={editingNotebook ? handleUpdateNotebook : handleAddNotebook}>
              {editingNotebook ? '保存' : '创建'}
            </button>
          </div>
        )}

        {notebooks.map(nb => (
          <NotebookCard
            key={nb.id}
            notebook={nb}
            onOpen={handleOpenNotebook}
            onReindex={handleReindex}
            onEdit={handleEditNotebook}
            onDelete={handleDeleteNotebook}
            eventBus={services.eventBus}
          />
        ))}
      </div>

      {/* Section 5: Advanced */}
      <div>
        <h3 style={{ margin: 0, marginBottom: '8px' }}>高级</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={async () => {
            const id = notebooks[0]?.id;
            if (!id) { window.alert('请先创建 Notebook'); return; }
            try {
              const r = await services.exportIndex(id);
              window.alert(`索引已导出到: ${r.vaultPath}`);
            } catch (e) {
              window.alert(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}>导出索引</button>
          <button onClick={async () => {
            if (!window.confirm('确定清除所有缓存?这会让所有 Notebook 重新索引')) return;
            try {
              await services.clearCache();
              window.alert('缓存已清除,所有 Notebook 已标记为待重建');
            } catch (e) {
              window.alert(`清除失败: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}>清除缓存</button>
          <button onClick={() => services.openDevTools()}>打开 DevTools</button>
        </div>
      </div>
    </div>
  );
}
