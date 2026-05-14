import React from 'react';
import type { EmbeddingConfig, Provider } from 'src/types/data';
import { t } from 'src/i18n';

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
  { id: 'Xenova/multilingual-e5-small', label: 'multilingual-e5-small (default, multilingual)' },
  { id: 'Xenova/all-MiniLM-L6-v2', label: 'all-MiniLM-L6-v2 (English)' },
];

export function EmbeddingSection({
  config, providers, coverage, modelDownloadState, downloadProgress, downloadError,
  onConfigChange, onDownloadModel, onTriggerReindex,
}: EmbeddingSectionProps) {
  const embeddingProviders = providers.filter(p => p.capabilities?.supportsEmbeddings);

  const coverageLabel = (() => {
    if (!config.enabled) return t('settings.vector.coverageNotEnabled');
    if (!coverage) return t('common.loading');
    if (coverage.outdated) return `✗ ${t('settings.vector.coverageOutdated')}`;
    if (coverage.total === 0) return t('settings.vector.coverageNoFiles');
    if (coverage.failed > 0) {
      return `⚠ ${t('settings.vector.coveragePartialFailed', { embedded: coverage.embedded, total: coverage.total, failed: coverage.failed })}`;
    }
    if (coverage.embedded === coverage.total) {
      return `✓ ${t('settings.vector.coverageFull', { embedded: coverage.embedded, total: coverage.total })}`;
    }
    return `⚠ ${t('settings.vector.coveragePartial', { embedded: coverage.embedded, total: coverage.total })}`;
  })();

  return (
    <div className="notebook-ai-embedding-section">
      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">{t('settings.vector.enable')}</div>
          <div className="setting-item-description">{t('settings.vector.enableDesc')}</div>
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
              <div className="setting-item-name">{t('settings.vector.source')}</div>
            </div>
            <div className="setting-item-control">
              <select
                value={config.source}
                onChange={e => onConfigChange({ source: e.target.value as 'api' | 'local' })}
              >
                <option value="local">{t('settings.vector.source.local')}</option>
                <option value="api">{t('settings.vector.source.api')}</option>
              </select>
            </div>
          </div>

          {config.source === 'api' && (
            <>
              <div className="setting-item">
                <div className="setting-item-info">
                  <div className="setting-item-name">{t('settings.vector.provider')}</div>
                  <div className="setting-item-description">{t('settings.vector.providerDesc')}</div>
                </div>
                <div className="setting-item-control">
                  <select
                    value={config.apiProviderId ?? ''}
                    onChange={e => onConfigChange({ apiProviderId: e.target.value })}
                  >
                    <option value="">{t('settings.vector.providerEmpty')}</option>
                    {embeddingProviders.map(p => (
                      <option key={p.id} value={p.id}>{p.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="setting-item">
                <div className="setting-item-info">
                  <div className="setting-item-name">{t('settings.vector.apiModel')}</div>
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
                  <div className="setting-item-name">{t('settings.vector.preset')}</div>
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
                  <div className="setting-item-name">{t('settings.vector.modelStatus')}</div>
                </div>
                <div className="setting-item-control">
                  {modelDownloadState === 'not-downloaded' && (
                    <button onClick={onDownloadModel}>{t('settings.vector.modelDownload')}</button>
                  )}
                  {modelDownloadState === 'downloading' && (
                    <div>
                      <progress value={downloadProgress} max={100} style={{ width: '120px' }} />
                      <span style={{ marginLeft: 8 }}>{downloadProgress}%</span>
                    </div>
                  )}
                  {modelDownloadState === 'ready' && (
                    <span style={{ color: 'var(--color-green)' }}>● {t('settings.vector.modelReady')}</span>
                  )}
                  {modelDownloadState === 'error' && (
                    <div>
                      <button onClick={onDownloadModel} style={{ marginRight: 8 }}>{t('common.retry')}</button>
                      <span style={{ color: 'var(--color-red)' }}>✗ {t('settings.vector.modelDownloadFailed')}</span>
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
              <div className="setting-item-name">{t('settings.vector.coverage')}</div>
              <div className="setting-item-description">{coverageLabel}</div>
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-item-info">
              <div className="setting-item-description">{t('settings.vector.reindexHint')}</div>
            </div>
            <div className="setting-item-control">
              <button onClick={onTriggerReindex}>{t('settings.vector.reindexAll')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
