import React from 'react';
import type { ImageConfig } from 'src/types/data';

// TODO(i18n): wire up t()
const COMMON_LANGS = [
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'chi_tra', label: 'Chinese (Traditional)' },
  { code: 'eng', label: 'English' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'kor', label: 'Korean' },
];

export interface ImageSectionProps {
  config: ImageConfig;
  ocrStatus: 'not-ready' | 'initializing' | 'ready' | 'error';
  ocrErrorMessage?: string | null;
  onConfigChange(patch: Partial<ImageConfig>): void;
  onInitOcr(): void;
}

export function ImageSection({ config, ocrStatus, ocrErrorMessage, onConfigChange, onInitOcr }: ImageSectionProps) {
  const toggleLang = (code: string) => {
    const has = config.ocrLangs.includes(code);
    const next = has ? config.ocrLangs.filter(c => c !== code) : [...config.ocrLangs, code];
    if (next.length === 0) return;
    onConfigChange({ ocrLangs: next });
  };

  const maxMB = Math.round(config.maxImageBytes / 1_000_000);

  return (
    <div className="notebook-ai-image-section">
      <div className="setting-item">
        <div className="setting-item-info">
          {/* TODO(i18n): wire up t() */}
          <div className="setting-item-name">Enable OCR (Tesseract.js)</div>
          <div className="setting-item-description">Extract text from images locally. Language packs are downloaded on demand.</div>
        </div>
        <div className="setting-item-control">
          <div
            className={`checkbox-container${config.ocrEnabled ? ' is-enabled' : ''}`}
            onClick={() => onConfigChange({ ocrEnabled: !config.ocrEnabled })}
          >
            <input type="checkbox" checked={config.ocrEnabled} readOnly />
          </div>
        </div>
      </div>

      {config.ocrEnabled && (
        <>
          <div className="setting-item">
            <div className="setting-item-info">
              {/* TODO(i18n): wire up t() */}
              <div className="setting-item-name">OCR languages</div>
              <div className="setting-item-description">Select at least one. Language packs are downloaded from the tesseract.js CDN on first use.</div>
            </div>
            <div className="setting-item-control" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {COMMON_LANGS.map(({ code, label }) => {
                const active = config.ocrLangs.includes(code);
                return (
                  <button
                    key={code}
                    onClick={() => toggleLang(code)}
                    style={{
                      padding: '2px 8px',
                      fontSize: '0.85em',
                      border: active ? '1px solid var(--interactive-accent)' : '1px solid var(--background-modifier-border)',
                      background: active ? 'var(--interactive-accent)' : 'transparent',
                      color: active ? 'var(--text-on-accent)' : 'var(--text-normal)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-item-info">
              {/* TODO(i18n): wire up t() */}
              <div className="setting-item-name">OCR status</div>
            </div>
            <div className="setting-item-control">
              {ocrStatus === 'not-ready' && (
                // TODO(i18n): wire up t()
                <button onClick={onInitOcr}>Initialize / download language packs</button>
              )}
              {ocrStatus === 'initializing' && (
                // TODO(i18n): wire up t()
                <span style={{ color: 'var(--text-muted)' }}>Downloading…</span>
              )}
              {ocrStatus === 'ready' && (
                // TODO(i18n): wire up t()
                <span style={{ color: 'var(--color-green)' }}>● Ready</span>
              )}
              {ocrStatus === 'error' && (
                <div>
                  {/* TODO(i18n): wire up t() */}
                  <button onClick={onInitOcr} style={{ marginRight: 8 }}>Retry</button>
                  <span style={{ color: 'var(--color-red)' }}>✗ Initialization failed</span>
                  {ocrErrorMessage && (
                    <div style={{
                      marginTop: 6,
                      padding: 6,
                      background: 'var(--background-modifier-error-rgb, var(--background-secondary))',
                      border: '1px solid var(--color-red)',
                      borderRadius: 4,
                      fontSize: '0.8em',
                      whiteSpace: 'pre-wrap',
                      maxWidth: 400,
                      color: 'var(--text-normal)',
                    }}>{ocrErrorMessage}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div className="setting-item">
        <div className="setting-item-info">
          {/* TODO(i18n): wire up t() */}
          <div className="setting-item-name">Enable vision descriptions</div>
          <div className="setting-item-description">Use the LLM assigned to the "Vision" task to describe image contents.</div>
        </div>
        <div className="setting-item-control">
          <div
            className={`checkbox-container${config.visionEnabled ? ' is-enabled' : ''}`}
            onClick={() => onConfigChange({ visionEnabled: !config.visionEnabled })}
          >
            <input type="checkbox" checked={config.visionEnabled} readOnly />
          </div>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          {/* TODO(i18n): wire up t() */}
          <div className="setting-item-name">Max image size (MB)</div>
          <div className="setting-item-description">Images larger than this are skipped to avoid blocking the indexer.</div>
        </div>
        <div className="setting-item-control">
          <input
            type="number"
            min={1}
            max={50}
            value={maxMB}
            onChange={e => onConfigChange({ maxImageBytes: Math.max(1, Number(e.target.value)) * 1_000_000 })}
            style={{ width: '60px' }}
          />
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          {/* TODO(i18n): wire up t() */}
          <div className="setting-item-description" style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
            Tip: Notebooks do not index images by default. Enable the png/jpg/jpeg/bmp/gif extensions in the notebook editor first.
          </div>
        </div>
      </div>
    </div>
  );
}
