import React, { useEffect, useRef } from 'react';
import { Component, MarkdownRenderer } from 'obsidian';
import { t } from 'src/i18n';
import type { ChatTurn } from 'src/types/chat';
import { usePluginServices } from 'src/ui/hooks/useStore';

interface Props {
  turn: ChatTurn;
  isDraft?: boolean;
  onSaveAsNote?: (turnId: string) => void;
}

export function ChatMessage({ turn, isDraft, onSaveAsNote }: Props) {
  const isUser = turn.role === 'user';
  const canSave =
    !isUser && !isDraft && !turn.error && !turn.cancelled && !!onSaveAsNote;
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '12px',
    }}>
      <div className="nai-chat-bubble" style={{
        background: isUser ? 'var(--interactive-accent)' : 'var(--background-secondary)',
        color: isUser ? 'var(--text-on-accent)' : 'var(--text-normal)',
        padding: '8px 12px',
        borderRadius: '8px',
        maxWidth: '85%',
        wordBreak: 'break-word',
        opacity: turn.error ? 0.7 : 1,
        border: turn.error ? '1px solid var(--color-red)' : 'none',
      }}>
        {isUser ? <PlainContent turn={turn} /> : <RenderedContent turn={turn} isDraft={isDraft} />}
      </div>
      {turn.cancelled && (
        <small style={{ color: 'var(--text-muted)' }}>{t('chat.cancelled')}</small>
      )}
      {canSave && (
        <button
          onClick={() => onSaveAsNote!(turn.id)}
          style={{
            marginTop: '4px',
            fontSize: '0.8em',
            padding: '2px 8px',
            background: 'transparent',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
          title={t('chatMessage.saveAsNoteTitle')}
        >
          {t('chatMessage.saveAsNote')}
        </button>
      )}
    </div>
  );
}

function PlainContent({ turn }: { turn: ChatTurn }) {
  return <div style={{ whiteSpace: 'pre-wrap' }}>{turn.content}</div>;
}

function RenderedContent({ turn, isDraft }: { turn: ChatTurn; isDraft?: boolean }) {
  const services = usePluginServices();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.empty();
    const component = new Component();
    component.load();

    // Render markdown as-is. Citations [N] are plain text in Obsidian's renderer
    // (bare [N] without a following URL is not treated as a link), so we can find
    // them in the DOM afterwards without any pre-render substitution.
    void MarkdownRenderer.render(services.app, turn.content, el, '', component)
      .then(() => {
        if ((turn.citations?.length ?? 0) > 0) {
          replaceCitations(el, turn.citations!, services.openVaultFile);
        }
      });

    return () => component.unload();
  }, [turn.content, turn.citations, services]);

  return (
    <>
      <div ref={containerRef} className="nai-chat-md" />
      {isDraft && <span style={{ animation: 'blink 1s infinite' }}>▋</span>}
    </>
  );
}

function replaceCitations(
  root: HTMLElement,
  citations: NonNullable<ChatTurn['citations']>,
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
        a.title = `${citation.headingPath.join(' > ') || t('citation.untitled')} — ${citation.filePath}\n\n${citation.preview}`;
        a.className = 'notebook-ai-citation';
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
