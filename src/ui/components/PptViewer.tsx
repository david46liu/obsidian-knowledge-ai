/**
 * PptViewer — Marp 幻灯片产物渲染组件
 *
 * 输入:
 *   - markdown: LLM 输出的 Marp 格式 markdown(由 splitMarpSlides 切分为单页)
 *   - citations: 与 artifact 关联的引用列表(用于放大模式中 [N] 跳转)
 *
 * 行为:
 *   - 卡片网格(CSS grid auto-fill, minmax 280px),每张幻灯片 16:9 容器,
 *     内部 <pre> 显示原文(不解析 [N],保持卡片干净)
 *   - 点击卡片 → 全屏放大 modal(fixed inset:0 + 半透明背景遮罩)
 *   - 放大模式工具栏:[上一页] [下一页] [关闭] + "i / N" 页码
 *   - 放大模式内部用 renderSlideWithCitations 把 [N] 解析为 CitationLink
 *   - 空 markdown 或解析无页 → 友好提示
 */
import React, { useMemo, useState } from 'react';
import { t } from 'src/i18n';
import type { Citation } from 'src/types/chat';
import { splitMarpSlides } from 'src/generation/marpSplit';
import { CitationLink } from 'src/ui/components/CitationLink';

interface Props {
  markdown: string;
  citations: Citation[];
}

export function PptViewer({ markdown, citations }: Props) {
  const slides = useMemo(() => splitMarpSlides(markdown), [markdown]);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);

  if (slides.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', padding: '12px' }}>
        {t('ppt.empty')}
      </div>
    );
  }

  const openZoom = (i: number) => setZoomIndex(i);
  const closeZoom = () => setZoomIndex(null);
  const prev = () => setZoomIndex(i => (i === null ? null : Math.max(0, i - 1)));
  const next = () =>
    setZoomIndex(i => (i === null ? null : Math.min(slides.length - 1, i + 1)));

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '12px',
        }}
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            onClick={() => openZoom(i)}
            style={{
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '6px',
              background: 'var(--background-secondary)',
              cursor: 'pointer',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
            title={t('ppt.expandTitle')}
          >
            {/* 16:9 区域:padding-top 56.25% 撑开 */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                paddingTop: '56.25%',
                background: 'var(--background-primary-alt)',
              }}
            >
              <pre
                style={{
                  position: 'absolute',
                  inset: 0,
                  margin: 0,
                  padding: '8px',
                  fontSize: '11px',
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--text-normal)',
                  fontFamily: 'var(--font-monospace, ui-monospace, monospace)',
                }}
              >
                {slide}
              </pre>
            </div>
            <div
              style={{
                padding: '4px 8px',
                fontSize: '0.8em',
                color: 'var(--text-muted)',
                borderTop: '1px solid var(--background-modifier-border)',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{t('ppt.slideOf', { current: i + 1, total: slides.length })}</span>
              {detectMermaid(slide) && (
                <span title={t('ppt.mermaidTitle')}>{t('ppt.mermaidBadge')}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {zoomIndex !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            padding: '24px',
          }}
          onClick={closeZoom}
        >
          {/* 工具栏 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
              color: 'var(--text-on-accent, #fff)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={prev}
              disabled={zoomIndex === 0}
              style={{ padding: '4px 12px' }}
            >
              {t('ppt.previous')}
            </button>
            <button
              onClick={next}
              disabled={zoomIndex === slides.length - 1}
              style={{ padding: '4px 12px' }}
            >
              {t('ppt.next')}
            </button>
            <span style={{ marginLeft: '12px', fontSize: '0.9em' }}>
              {zoomIndex + 1} / {slides.length}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={closeZoom} style={{ padding: '4px 12px' }}>
              {t('common.close')}
            </button>
          </div>

          {/* 放大幻灯片主体(16:9 居中) */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                width: 'min(90vw, calc(80vh * 16 / 9))',
                aspectRatio: '16 / 9',
                background: 'var(--background-primary)',
                color: 'var(--text-normal)',
                padding: '24px',
                borderRadius: '8px',
                overflow: 'auto',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '15px',
                lineHeight: 1.6,
              }}
            >
              {renderSlideWithCitations(slides[zoomIndex], citations)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 简单检测幻灯片是否含 mermaid 代码块 */
function detectMermaid(slide: string): boolean {
  return /```mermaid/.test(slide);
}

/**
 * 解析单张幻灯片文本中的 [N] 引用,替换为 CitationLink。
 * 复用 ArtifactsTab.renderWithCitations 的模式。
 */
function renderSlideWithCitations(
  content: string,
  citations: Citation[],
): React.ReactNode {
  if (!citations || citations.length === 0) return content;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > cursor) parts.push(content.slice(cursor, m.index));
    const idx = Number(m[1]);
    const c = citations.find(x => x.index === idx);
    parts.push(c ? <CitationLink key={`c-${m.index}`} citation={c} /> : m[0]);
    cursor = m.index + m[0].length;
  }
  if (cursor < content.length) parts.push(content.slice(cursor));
  return parts;
}
