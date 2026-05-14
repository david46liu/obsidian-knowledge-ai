import React, { useState, useRef, useEffect } from 'react';
import { useNotebookAIStore, usePluginServices } from 'src/ui/hooks/useStore';
import { useChatSession } from 'src/ui/hooks/useChatSession';
import { ChatMessage } from 'src/ui/components/ChatMessage';
import { ArtifactsTab } from 'src/ui/views/ArtifactsTab';

const PHASE_LABEL: Record<string, string> = {
  retrieving: '检索中...',
  reranking: '重排序中(可能需要数十秒)...',
  generating: '生成回答中...',
};

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
        <button onClick={() => setTab('chat')} disabled={tab === 'chat'}>对话</button>
        <button onClick={() => setTab('artifacts')} disabled={tab === 'artifacts'}>产物</button>
      </div>
      {/* 用 display 切换保持双 mount,避免 streaming 中切 tab 中断生成或丢失 state */}
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
    return <div style={{ padding: '16px' }}>请先在设置页选择 Notebook 并打开</div>;
  }

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    ask(text, { rerank, topK, expandQuery, expandNeighbors, summaryMode });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--background-modifier-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{notebook.name}</strong>
          <small style={{ color: 'var(--text-muted)' }}>{session.turns.length} 轮</small>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '0.85em', flexWrap: 'wrap' }}>
          <label>
            <input
              type="checkbox"
              checked={rerank}
              onChange={e => setRerank(e.target.checked)}
            /> 重排序
          </label>
          <label title="把问题用 LLM 改写成多个角度的查询,并行检索后合并。会增加 1 次 LLM 调用">
            <input
              type="checkbox"
              checked={expandQuery}
              onChange={e => setExpandQuery(e.target.checked)}
            /> 查询扩展
          </label>
          <label>
            片段数 <input
              type="number"
              min={1}
              max={50}
              value={topK}
              onChange={e => setTopK(Number(e.target.value))}
              style={{ width: '50px' }}
            />
          </label>
          <label title="每个命中片段自动带上同文档前后 N 个相邻片段,补全上下文">
            相邻 <input
              type="number"
              min={0}
              max={3}
              value={expandNeighbors}
              onChange={e => setExpandNeighbors(Number(e.target.value))}
              style={{ width: '40px' }}
            />
          </label>
          <label title="对「总结/汇总/有哪些」类问题切换到按文档分组的广覆盖检索">
            摘要 <select
              value={summaryMode}
              onChange={e => setSummaryMode(e.target.value as 'auto' | 'on' | 'off')}
              style={{ fontSize: '0.95em' }}
            >
              <option value="auto">自动</option>
              <option value="on">强制开</option>
              <option value="off">强制关</option>
            </select>
          </label>
        </div>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {session.turns.map(t => <ChatMessage key={t.id} turn={t} onSaveAsNote={handleSaveAsNote} />)}
        {draftTurn && <ChatMessage turn={draftTurn} isDraft />}
        {phase.phase !== 'idle' && phase.phase !== 'error' && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
            {PHASE_LABEL[phase.phase] ?? phase.phase}
          </div>
        )}
        {phase.phase === 'error' && phase.error && (
          <div style={{ color: 'var(--color-red)', fontSize: '0.85em' }}>
            错误: {phase.error}
          </div>
        )}
      </div>

      {/* 输入区 */}
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
          placeholder="问点什么...(Shift+Enter 换行,Enter 发送)"
          rows={3}
          style={{ width: '100%', resize: 'vertical' }}
          disabled={streaming}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
          {streaming
            ? <button onClick={cancel}>取消</button>
            : <button onClick={handleSubmit} disabled={!input.trim()}>发送</button>}
        </div>
      </div>
    </div>
  );
}
