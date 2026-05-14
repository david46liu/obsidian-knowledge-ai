import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotebookId } from 'src/types/data';
import type { Artifact, ArtifactKind, GenerateOptions } from 'src/types/artifact';
import type { Citation } from 'src/types/chat';
import { usePluginServices } from 'src/ui/hooks/useStore';

export interface ArtifactsPhaseState {
  phase: 'idle' | 'retrieving' | 'generating' | 'error';
  error?: string;
}

export function useArtifacts(notebookId: NotebookId | undefined) {
  const services = usePluginServices();
  const [list, setList] = useState<Artifact[]>([]);
  const [active, setActive] = useState<Artifact | null>(null);
  const [streamingKind, setStreamingKind] = useState<ArtifactKind | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [draftCitations, setDraftCitations] = useState<Citation[]>([]);
  const [draftTruncated, setDraftTruncated] = useState(false);
  const [phase, setPhase] = useState<ArtifactsPhaseState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!notebookId) {
      setList([]);
      return;
    }
    const items = await services.listArtifacts(notebookId);
    setList(items);
  }, [notebookId, services]);

  useEffect(() => {
    if (!notebookId) {
      setList([]);
      setActive(null);
      return;
    }
    let cancelled = false;
    services.listArtifacts(notebookId).then(items => {
      if (!cancelled) setList(items);
    });
    return () => { cancelled = true; };
  }, [notebookId, services]);

  const generate = useCallback(async (kind: ArtifactKind, opts?: Omit<GenerateOptions, 'signal'>) => {
    // 用 ref 防并发(state 异步更新无法在同一事件批次拦截重复触发)
    if (!notebookId || streamingRef.current) return;
    streamingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setStreamingKind(kind);
    setDraftContent('');
    setDraftCitations([]);
    setDraftTruncated(false);
    setPhase({ phase: 'retrieving' });

    let acc = '';
    try {
      for await (const ev of services.generate(notebookId, kind, { ...opts, signal: controller.signal })) {
        if (ev.type === 'retrieving') setPhase({ phase: 'retrieving' });
        else if (ev.type === 'generating') setPhase({ phase: 'generating' });
        else if (ev.type === 'citations') {
          setDraftCitations(ev.citations);
          setDraftTruncated(ev.truncated);
        } else if (ev.type === 'token') {
          acc += ev.content;
          setDraftContent(acc);
        } else if (ev.type === 'done') {
          await refresh();
          setActive(ev.artifact);
        } else if (ev.type === 'error') {
          setPhase({ phase: 'error', error: ev.error });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhase({ phase: 'error', error: msg });
    } finally {
      streamingRef.current = false;
      setStreamingKind(null);
      setDraftContent('');
      setDraftCitations([]);
      setDraftTruncated(false);
      abortRef.current = null;
      setPhase(p => p.phase === 'error' ? p : { phase: 'idle' });
    }
  }, [notebookId, services, refresh]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const open = useCallback(async (artifactId: string) => {
    if (!notebookId) return;
    const a = await services.loadArtifact(notebookId, artifactId);
    if (a) setActive(a);
  }, [notebookId, services]);

  const remove = useCallback(async (id: string) => {
    if (!notebookId) return;
    await services.deleteArtifact(notebookId, id);
    setActive(curr => curr && curr.id === id ? null : curr);
    await refresh();
  }, [notebookId, services, refresh]);

  return {
    list,
    active,
    setActive,
    streamingKind,
    draftContent,
    draftCitations,
    draftTruncated,
    phase,
    generate,
    cancel,
    open,
    remove,
    refresh,
  };
}
