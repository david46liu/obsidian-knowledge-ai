import React, { useEffect, useRef, useState } from 'react';
import { Component, MarkdownRenderer, Notice } from 'obsidian';
import { useNotebookAIStore, usePluginServices } from 'src/ui/hooks/useStore';
import { useArtifacts } from 'src/ui/hooks/useArtifacts';
import { GenerateMenu } from 'src/ui/components/GenerateMenu';
import { ArtifactCard } from 'src/ui/components/ArtifactCard';
import { MindMapViewer } from 'src/ui/components/MindMapViewer';
import { PptViewer } from 'src/ui/components/PptViewer';
import type { Artifact, ArtifactKind } from 'src/types/artifact';

const PHASE_LABEL: Record<string, string> = {
  retrieving: '检索中...',
  generating: '生成中...',
};

export function ArtifactsTab() {
  const notebookId = useNotebookAIStore(s => s.activeNotebookId);
  const services = usePluginServices();
  const {
    list,
    active,
    streamingKind,
    draftContent,
    draftCitations,
    draftTruncated,
    phase,
    generate,
    cancel,
    open,
    remove,
  } = useArtifacts(notebookId);

  if (!notebookId) {
    return <div style={{ padding: '16px' }}>请先在设置页选择 Notebook 并打开</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部:生成菜单 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--background-modifier-border)' }}>
        <GenerateMenu
          streamingKind={streamingKind}
          onGenerate={(kind) => generate(kind)}
          onCancel={cancel}
        />
        {phase.phase !== 'idle' && phase.phase !== 'error' && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginTop: '4px' }}>
            {PHASE_LABEL[phase.phase] ?? phase.phase}
          </div>
        )}
        {phase.phase === 'error' && phase.error && (
          <div style={{ color: 'var(--color-red)', fontSize: '0.85em', marginTop: '4px' }}>
            错误: {phase.error}
          </div>
        )}
      </div>

      {/* 主体:左 列表 / 右 阅读区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          style={{
            width: '40%',
            overflowY: 'auto',
            padding: '8px',
            borderRight: '1px solid var(--background-modifier-border)',
          }}
        >
          {streamingKind && (
            <div
              style={{
                padding: '8px 10px',
                marginBottom: '6px',
                borderRadius: '6px',
                background: 'var(--background-modifier-hover)',
                border: '1px dashed var(--interactive-accent)',
                fontStyle: 'italic',
              }}
            >
              <strong>生成中:{streamingKind}</strong>
              <small style={{ display: 'block', color: 'var(--text-muted)', marginTop: '2px' }}>
                {draftContent.length} 字符 / {draftCitations.length} 引用
              </small>
            </div>
          )}
          {list.length === 0 && !streamingKind && (
            <div style={{ color: 'var(--text-muted)', padding: '12px', textAlign: 'center' }}>
              暂无产物,使用上方按钮生成
            </div>
          )}
          {list.map(a => (
            <ArtifactCard
              key={a.id}
              artifact={a}
              active={active?.id === a.id}
              onOpen={(x) => open(x.id)}
              onDelete={(x) => remove(x.id)}
              onExport={(x) => services.exportArtifact(x.id)}
            />
          ))}
        </div>
        <div style={{ width: '60%', overflowY: 'auto', padding: '12px' }}>
          {streamingKind ? (
            <ArtifactReader
              title={`生成中:${streamingKind}`}
              content={draftContent || '(等待 token...)'}
              citations={draftCitations}
              truncated={draftTruncated}
              kind={streamingKind ?? undefined}
              draft
            />
          ) : active ? (
            <ArtifactReader
              title={active.title}
              content={active.content}
              citations={active.citations}
              modelUsed={active.modelUsed}
              generatedAt={active.generatedAt}
              truncated={active.truncated}
              kind={active.kind}
            />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '12px' }}>
              选择左侧的产物以查看
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ReaderProps {
  title: string;
  content: string;
  citations: Artifact['citations'];
  modelUsed?: string;
  generatedAt?: number;
  truncated?: boolean;
  draft?: boolean;
  /** active 模式必传;draft 模式可不传(用 streamingKind 兜底) */
  kind?: ArtifactKind;
}

function ArtifactReader({
  title,
  content,
  citations,
  modelUsed,
  generatedAt,
  truncated,
  draft,
  kind,
}: ReaderProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      new Notice('复制失败,请手动选择文本');
    }
  };

  const isMd = kind !== 'mind-map' && kind !== 'ppt';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <h3 style={{ marginTop: 0, flex: 1 }}>{title}</h3>
        {isMd && !draft && content && (
          <button
            onClick={handleCopy}
            title="复制全文 markdown 到剪贴板"
            style={{
              fontSize: '0.85em',
              padding: '4px 10px',
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            {copied ? '已复制 ✓' : '复制全文'}
          </button>
        )}
      </div>
      {!draft && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginBottom: '12px' }}>
          {generatedAt && <span>{new Date(generatedAt).toLocaleString()}</span>}
          {modelUsed && <span style={{ marginLeft: '8px' }}>· {modelUsed}</span>}
          {truncated && (
            <span
              style={{ marginLeft: '8px', color: 'var(--color-orange)', cursor: 'help' }}
              title="资料源超过单次喂给 LLM 的上限,只取了前面一部分文档生成。输出内容本身完整,但可能漏掉后段文档的信息。"
            >
              · 资料截断
            </span>
          )}
        </div>
      )}
      {kind === 'mind-map' ? (
        <MindMapViewer markdown={content} citations={citations} />
      ) : kind === 'ppt' ? (
        <PptViewer markdown={content} citations={citations} />
      ) : (
        <ArtifactMarkdown
          content={content}
          citations={citations}
          draft={draft}
        />
      )}
    </div>
  );
}

/**
 * 用 Obsidian MarkdownRenderer 渲染产物正文,实现真正的 markdown 排版(标题/列表/粗体/代码块/表格)。
 * 引用 [N] 在 markdown 渲染完成后通过 DOM walker 替换为可点击链接。
 *
 * 流式 draft 模式:每次 content 变化重渲染,token 速率下重渲染开销 < 60ms 仍流畅。
 */
function ArtifactMarkdown({
  content,
  citations,
  draft,
}: {
  content: string;
  citations: Artifact['citations'];
  draft?: boolean;
}) {
  const services = usePluginServices();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.empty();
    const component = new Component();
    component.load();
    void MarkdownRenderer.render(services.app, content || '_(等待 token...)_', el, '', component)
      .then(() => {
        if ((citations?.length ?? 0) > 0) {
          replaceCitations(el, citations!, services.openVaultFile);
        }
      });
    return () => component.unload();
  }, [content, citations, services]);

  return (
    <>
      <div ref={containerRef} className="nai-artifact-md" />
      {draft && <span style={{ animation: 'blink 1s infinite' }}>▋</span>}
    </>
  );
}

function replaceCitations(
  root: HTMLElement,
  citations: NonNullable<Artifact['citations']>,
  openVaultFile: (path: string, charStart?: number) => Promise<void> | void,
): void {
  const re = /\[(\d+)\]/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    re.lastIndex = 0;
    if (re.test((node as Text).nodeValue ?? '')) textNodes.push(node as Text);
  }
  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? '';
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(value)) !== null) {
      if (m.index > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, m.index)));
      const idx = Number(m[1]);
      const citation = citations.find(c => c.index === idx);
      if (citation) {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = `[${idx}]`;
        a.title = `${citation.headingPath.join(' > ') || '(无标题)'} — ${citation.filePath}\n\n${citation.preview}`;
        a.style.color = 'var(--interactive-accent)';
        a.style.textDecoration = 'none';
        a.style.padding = '0 2px';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          void openVaultFile(citation.filePath, citation.charStart);
        });
        frag.appendChild(a);
      } else {
        frag.appendChild(document.createTextNode(m[0]));
      }
      cursor = m.index + m[0].length;
    }
    if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}
