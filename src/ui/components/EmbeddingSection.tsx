import React from 'react';
import type { EmbeddingConfig, Provider } from 'src/types/data';

export interface VectorCoverage {
  total: number;
  embedded: number;
  failed: number;
  outdated: boolean;
}

export interface EmbeddingSectionProps {
  config: EmbeddingConfig;
  providers: Provider[];
  coverage: VectorCoverage | null;
  modelDownloadState: 'not-downloaded' | 'downloading' | 'ready' | 'error';
  downloadProgress: number;   // 0-100
  downloadError?: string | null;
  onConfigChange: (patch: Partial<EmbeddingConfig>) => void;
  onDownloadModel: () => void;
  onTriggerReindex: () => void;
}

const PRESET_MODELS = [
  { id: 'Xenova/multilingual-e5-small', label: 'multilingual-e5-small (默认, 多语言)' },
  { id: 'Xenova/all-MiniLM-L6-v2', label: 'all-MiniLM-L6-v2 (英文)' },
];

export function EmbeddingSection({
  config, providers, coverage, modelDownloadState, downloadProgress, downloadError,
  onConfigChange, onDownloadModel, onTriggerReindex,
}: EmbeddingSectionProps) {
  const embeddingProviders = providers.filter(p => p.capabilities?.supportsEmbeddings);

  const coverageLabel = (() => {
    if (!config.enabled) return '— 未启用';
    if (!coverage) return '读取中...';
    if (coverage.outdated) return '✗ 向量已过期，请重新索引';
    if (coverage.total === 0) return '— 无文件';
    if (coverage.failed > 0) {
      return `⚠ 部分覆盖 (${coverage.embedded} / ${coverage.total}，${coverage.failed} 个文件失败)`;
    }
    if (coverage.embedded === coverage.total) {
      return `✓ 全部已向量化 (${coverage.embedded} / ${coverage.total} chunks)`;
    }
    return `⚠ 部分覆盖 (${coverage.embedded} / ${coverage.total})`;
  })();

  return (
    <div className="notebook-ai-embedding-section">
      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">启用向量检索</div>
          <div className="setting-item-description">BM25 + 语义检索混合，提升召回质量</div>
        </div>
        <div className="setting-item-control">
          <div
            className={`checkbox-container${config.enabled ? ' is-enabled' : ''}`}
            onClick={() => onConfigChange({ enabled: !config.enabled })}
          >
            <input type="checkbox" checked={config.enabled} readOnly />
          </div>
        </div>
      </div>

      {config.enabled && (
        <>
          <div className="setting-item">
            <div className="setting-item-info">
              <div className="setting-item-name">Embedding 来源</div>
            </div>
            <div className="setting-item-control">
              <select
                value={config.source}
                onChange={e => onConfigChange({ source: e.target.value as 'api' | 'local' })}
              >
                <option value="local">本地模型</option>
                <option value="api">外部 API</option>
              </select>
            </div>
          </div>

          {config.source === 'api' && (
            <>
              <div className="setting-item">
                <div className="setting-item-info">
                  <div className="setting-item-name">Provider</div>
                  <div className="setting-item-description">仅显示支持 embedding 能力的 provider</div>
                </div>
                <div className="setting-item-control">
                  <select
                    value={config.apiProviderId ?? ''}
                    onChange={e => onConfigChange({ apiProviderId: e.target.value })}
                  >
                    <option value="">-- 选择 Provider --</option>
                    {embeddingProviders.map(p => (
                      <option key={p.id} value={p.id}>{p.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="setting-item">
                <div className="setting-item-info">
                  <div className="setting-item-name">模型名称</div>
                </div>
                <div className="setting-item-control">
                  <input
                    type="text"
                    placeholder="text-embedding-3-small"
                    value={config.apiModel ?? ''}
                    onChange={e => onConfigChange({ apiModel: e.target.value })}
                  />
                </div>
              </div>
            </>
          )}

          {config.source === 'local' && (
            <>
              <div className="setting-item">
                <div className="setting-item-info">
                  <div className="setting-item-name">预设模型</div>
                </div>
                <div className="setting-item-control">
                  <select
                    value={config.localModelId ?? 'Xenova/multilingual-e5-small'}
                    onChange={e => onConfigChange({ localModelId: e.target.value })}
                  >
                    {PRESET_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="setting-item">
                <div className="setting-item-info">
                  <div className="setting-item-name">模型状态</div>
                </div>
                <div className="setting-item-control">
                  {modelDownloadState === 'not-downloaded' && (
                    <button onClick={onDownloadModel}>下载模型</button>
                  )}
                  {modelDownloadState === 'downloading' && (
                    <div>
                      <progress value={downloadProgress} max={100} style={{ width: '120px' }} />
                      <span style={{ marginLeft: 8 }}>{downloadProgress}%</span>
                    </div>
                  )}
                  {modelDownloadState === 'ready' && (
                    <span style={{ color: 'var(--color-green)' }}>● 就绪</span>
                  )}
                  {modelDownloadState === 'error' && (
                    <div>
                      <button onClick={onDownloadModel} style={{ marginRight: 8 }}>重试</button>
                      <span style={{ color: 'var(--color-red)' }}>✗ 下载失败</span>
                      {downloadError && (
                        <div style={{
                          marginTop: 6,
                          padding: 6,
                          background: 'var(--background-secondary)',
                          border: '1px solid var(--color-red)',
                          borderRadius: 4,
                          fontSize: '0.8em',
                          whiteSpace: 'pre-wrap',
                          maxWidth: 400,
                          color: 'var(--text-normal)',
                        }}>{downloadError}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="setting-item">
            <div className="setting-item-info">
              <div className="setting-item-name">向量覆盖</div>
              <div className="setting-item-description">{coverageLabel}</div>
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-item-info">
              <div className="setting-item-description">切换模型后需重新索引所有 Notebook 才能生效</div>
            </div>
            <div className="setting-item-control">
              <button onClick={onTriggerReindex}>触发全量重新索引</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
