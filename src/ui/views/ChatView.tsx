import React, { useState, useRef, useEffect } from 'react';
import { useNotebookAIStore, usePluginServices } from 'src/ui/hooks/useStore';
import { useChatSession } from 'src/ui/hooks/useChatSession';
import { ChatMessage } from 'src/ui/components/ChatMessage';
import { ArtifactsTab } from 'src/ui/views/ArtifactsTab';
import { t } from 'src/i18n';

export function ChatView() {
  const tab = useNotebookAIStore(s => s.chatTab);
  const setTab = useNotebookAIStore(s => s.setChatTab);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          gap: '4px',
          padding: '6px 12px',
          borderBottom: '1px solid var(--background-modifier-border)',
        }}
      >
        <button onClick={() => setTab('chat')} disabled={tab === 'chat'}>{t('chat.tab.chat')}</button>
        <button onClick={() => setTab('artifacts')} disabled={tab === 'artifacts'}>{t('chat.tab.artifacts')}</button>
      </div>
      {/* Keep both panels mounted via display toggle so streaming in one tab
          doesn't get torn down when the user switches to the other. */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: tab === 'chat' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ChatPanel />
        </div>
        <div style={{ display: tab === 'artifacts' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ArtifactsTab />
        </div>
      </div>
    </div>
  );
}

function ChatPanel() {
  const notebookId = useNotebookAIStore(s => s.activeNotebookId);
  const notebooks = useNotebookAIStore(s => s.notebooks);
  const notebook = notebooks.find(n => n.id === notebookId);
  const services = usePluginServices();
  const { session, draftTurn, streaming, phase, ask, cancel } = useChatSession(notebookId);

  const [input, setInput] = useState('');
  const [rerank, setRerank] = useState(true);
  const [topK, setTopK] = useState(15);
  const [expandQuery, setExpandQuery] = useState(true);
  const [expandNeighbors, setExpandNeighbors] = useState(1);
  const [summaryMode, setSummaryMode] = useState<'auto' | 'on' | 'off'>('auto');
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSaveAsNote = (turnId: string) => {
    if (!notebookId || !services.saveTurnAsNote) return;
    void services.saveTurnAsNote(notebookId, turnId).catch(() => { /* main.ts shows Notice */ });
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session?.turns.length, draftTurn?.content]);

  if (!notebook || !session) {
    return <div style={{ padding: '16px' }}>{t('chat.empty')}</div>;
  }

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    ask(text, { rerank, topK, expandQuery, expandNeighbors, summaryMode });
  };

  const phaseLabel = (() => {
    switch (phase.phase) {
      case 'retrieving': return t('chat.phase.retrieving');
      case 'reranking': return t('chat.phase.reranking');
      case 'generating': return t('chat.phase.generating');
      default: return phase.phase;
    }
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--background-modifier-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{notebook.name}</strong>
          <small style={{ color: 'var(--text-muted)' }}>{t('chat.turnCount', { count: session.turns.length })}</small>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '0.85em', flexWrap: 'wrap' }}>
          <label>
            <input
              type="checkbox"
              checked={rerank}
              onChange={e => setRerank(e.target.checked)}
            /> {t('chat.opt.rerank')}
          </label>
          <label title={t('chat.opt.expandQueryTitle')}>
            <input
              type="checkbox"
              checked={expandQuery}
              onChange={e => setExpandQuery(e.target.checked)}
            /> {t('chat.opt.expandQuery')}
          </label>
          <label>
            {t('chat.opt.topK')} <input
              type="number"
              min={1}
              max={50}
              value={topK}
              onChange={e => setTopK(Number(e.target.value))}
              style={{ width: '50px' }}
            />
          </label>
          <label title={t('chat.opt.expandNeighborsTitle')}>
            {t('chat.opt.expandNeighbors')} <input
              type="number"
              min={0}
              max={3}
              value={expandNeighbors}
              onChange={e => setExpandNeighbors(Number(e.target.value))}
              style={{ width: '40px' }}
            />
          </label>
          <label title={t('chat.opt.summaryModeTitle')}>
            {t('chat.opt.summaryMode')} <select
              value={summaryMode}
              onChange={e => setSummaryMode(e.target.value as 'auto' | 'on' | 'off')}
              style={{ fontSize: '0.95em' }}
            >
              <option value="auto">{t('chat.opt.summaryMode.auto')}</option>
              <option value="on">{t('chat.opt.summaryMode.on')}</option>
              <option value="off">{t('chat.opt.summaryMode.off')}</option>
            </select>
          </label>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {session.turns.map(turn => <ChatMessage key={turn.id} turn={turn} onSaveAsNote={handleSaveAsNote} />)}
        {draftTurn && <ChatMessage turn={draftTurn} isDraft />}
        {phase.phase !== 'idle' && phase.phase !== 'error' && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
            {phaseLabel}
          </div>
        )}
        {phase.phase === 'error' && phase.error && (
          <div style={{ color: 'var(--color-red)', fontSize: '0.85em' }}>
            {t('common.error')}: {phase.error}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--background-modifier-border)' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={t('chat.placeholderHelp')}
          rows={3}
          style={{ width: '100%', resize: 'vertical' }}
          disabled={streaming}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
          {streaming
            ? <button onClick={cancel}>{t('common.cancel')}</button>
            : <button onClick={handleSubmit} disabled={!input.trim()}>{t('chat.send')}</button>}
        </div>
      </div>
    </div>
  );
}
