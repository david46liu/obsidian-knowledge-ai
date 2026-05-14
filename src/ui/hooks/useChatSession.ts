import { useEffect, useState, useRef, useCallback } from 'react';
import type { ChatSession, ChatTurn, AskOptions } from 'src/types/chat';
import type { NotebookId } from 'src/types/data';
import { usePluginServices } from 'src/ui/hooks/useStore';

export interface ChatPhaseState {
  phase: 'idle' | 'retrieving' | 'reranking' | 'generating' | 'error';
  error?: string;
}

export function useChatSession(notebookId: NotebookId | undefined) {
  const services = usePluginServices();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [phase, setPhase] = useState<ChatPhaseState>({ phase: 'idle' });
  const [draftTurn, setDraftTurn] = useState<ChatTurn | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!notebookId) {
      setSession(null);
      return;
    }
    let cancelled = false;
    services.loadActiveSession(notebookId).then(s => {
      if (!cancelled) setSession(s);
    });
    return () => { cancelled = true; };
  }, [notebookId, services]);

  const ask = useCallback(async (userText: string, opts?: Omit<AskOptions, 'signal'>) => {
    if (!session || !notebookId || streaming) return;

    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userText,
      createdAt: Date.now(),
    };
    try {
      await services.appendTurn(notebookId, session.id, userTurn);
    } catch (e) {
      // user turn 持久化失败仍推进;Task 5 装配真实 appendTurn 后通常不会抛
      console.error('[useChatSession] appendTurn(user) failed', e);
    }
    setSession(s => s ? { ...s, turns: [...s.turns, userTurn] } : s);

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setDraftTurn({ id: 'draft', role: 'assistant', content: '', createdAt: Date.now() });

    let accContent = '';

    // 持久化 + state 更新二合一辅助:appendTurn 失败不阻塞 UI 推进
    const persistAndPushTurn = async (turn: ChatTurn) => {
      try {
        await services.appendTurn(notebookId, session.id, turn);
      } catch (e) {
        // 落盘失败时仍把 turn 加入内存 session,让用户能看到回答;
        // 错误通过 console 暴露给开发者
        console.error('[useChatSession] appendTurn failed', e);
      }
      setSession(s => s ? { ...s, turns: [...s.turns, turn] } : s);
    };

    try {
      for await (const ev of services.chat(notebookId, session.turns, userText, { ...opts, signal: controller.signal })) {
        if (ev.type === 'retrieving') setPhase({ phase: 'retrieving' });
        else if (ev.type === 'reranking') setPhase({ phase: 'reranking' });
        else if (ev.type === 'generating') setPhase({ phase: 'generating' });
        else if (ev.type === 'citations') {
          setDraftTurn(t => t ? { ...t, citations: ev.citations } : t);
        } else if (ev.type === 'token') {
          accContent += ev.content;
          setDraftTurn(t => t ? { ...t, content: accContent } : t);
        } else if (ev.type === 'done') {
          await persistAndPushTurn(ev.turn);
          setDraftTurn(null);
        } else if (ev.type === 'error') {
          const errTurn: ChatTurn = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: ev.error,
            error: ev.error,
            createdAt: Date.now(),
          };
          await persistAndPushTurn(errTurn);
          setDraftTurn(null);
          setPhase({ phase: 'error', error: ev.error });
        }
      }
    } catch (e) {
      // stream 自身抛错(如 chat() 在 yield 前异常):清 draftTurn 并 emit error 态
      const msg = e instanceof Error ? e.message : String(e);
      setDraftTurn(null);
      setPhase({ phase: 'error', error: msg });
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setPhase(p => p.phase === 'error' ? p : { phase: 'idle' });
    }
  }, [session, notebookId, services, streaming]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { session, draftTurn, streaming, phase, ask, cancel };
}
