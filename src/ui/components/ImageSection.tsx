import React from 'react';
import { t } from 'src/i18n';
import type { ImageConfig } from 'src/types/data';

const COMMON_LANGS: Array<{ code: string; labelKey: string }> = [
  { code: 'chi_sim', labelKey: 'image.lang.chiSim' },
  { code: 'chi_tra', labelKey: 'image.lang.chiTra' },
  { code: 'eng', labelKey: 'image.lang.eng' },
  { code: 'jpn', labelKey: 'image.lang.jpn' },
  { code: 'kor', labelKey: 'image.lang.kor' },
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
          <div className="setting-item-name">{t('image.ocr.enableName')}</div>
          <div className="setting-item-description">{t('image.ocr.enableDesc')}</div>
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
              <div className="setting-item-name">{t('image.ocr.langsName')}</div>
              <div className="setting-item-description">{t('image.ocr.langsDesc')}</div>
            </div>
            <div className="setting-item-control" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {COMMON_LANGS.map(({ code, labelKey }) => {
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
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-item-info">
              <div className="setting-item-name">{t('image.ocr.statusName')}</div>
            </div>
            <div className="setting-item-control">
              {ocrStatus === 'not-ready' && (
                <button onClick={onInitOcr}>{t('image.ocr.initButton')}</button>
              )}
              {ocrStatus === 'initializing' && (
                <span style={{ color: 'var(--text-muted)' }}>{t('image.ocr.downloading')}</span>
              )}
              {ocrStatus === 'ready' && (
                <span style={{ color: 'var(--color-green)' }}>{t('image.ocr.statusReady')}</span>
              )}
              {ocrStatus === 'error' && (
                <div>
                  <button onClick={onInitOcr} style={{ marginRight: 8 }}>{t('common.retry')}</button>
                  <span style={{ color: 'var(--color-red)' }}>{t('image.ocr.statusFailed')}</span>
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
          <div className="setting-item-name">{t('image.vision.enableName')}</div>
          <div className="setting-item-description">{t('image.vision.enableDesc')}</div>
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
          <div className="setting-item-name">{t('image.maxSize.name')}</div>
          <div className="setting-item-description">{t('image.maxSize.desc')}</div>
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
          <div className="setting-item-description" style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
            {t('image.tip.enableExtensions')}
          </div>
        </div>
      </div>
    </div>
  );
}
