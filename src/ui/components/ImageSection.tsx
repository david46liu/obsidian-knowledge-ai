import React from 'react';
import type { ImageConfig } from 'src/types/data';

const COMMON_LANGS = [
  { code: 'chi_sim', label: '中文简体' },
  { code: 'chi_tra', label: '中文繁体' },
  { code: 'eng', label: '英文' },
  { code: 'jpn', label: '日文' },
  { code: 'kor', label: '韩文' },
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
          <div className="setting-item-name">启用 OCR (Tesseract.js)</div>
          <div className="setting-item-description">从图片中抽取文字，本地运行，按需下载语言包</div>
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
              <div className="setting-item-name">OCR 语言</div>
              <div className="setting-item-description">至少选一种；首次使用会从 tesseract.js CDN 下载</div>
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
              <div className="setting-item-name">OCR 状态</div>
            </div>
            <div className="setting-item-control">
              {ocrStatus === 'not-ready' && (
                <button onClick={onInitOcr}>初始化 / 下载语言包</button>
              )}
              {ocrStatus === 'initializing' && (
                <span style={{ color: 'var(--text-muted)' }}>下载中…</span>
              )}
              {ocrStatus === 'ready' && (
                <span style={{ color: 'var(--color-green)' }}>● 就绪</span>
              )}
              {ocrStatus === 'error' && (
                <div>
                  <button onClick={onInitOcr} style={{ marginRight: 8 }}>重试</button>
                  <span style={{ color: 'var(--color-red)' }}>✗ 初始化失败</span>
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
          <div className="setting-item-name">启用 Vision 描述</div>
          <div className="setting-item-description">调用任务面板中分配给 "视觉理解" 的 LLM 描述图片内容</div>
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
          <div className="setting-item-name">最大图片大小 (MB)</div>
          <div className="setting-item-description">超过该大小的图片会跳过索引（避免巨图阻塞）</div>
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
            提示：默认 notebook 不索引图片。在 notebook 编辑里勾选 png/jpg/jpeg/bmp/gif 扩展名后才会索引。
          </div>
        </div>
      </div>
    </div>
  );
}
