import { useState, useEffect } from 'react';
import type { IndexerEventBus } from 'src/indexer/events';
import type { NotebookId } from 'src/types/data';

export interface IndexProgress {
  done: number;
  total: number;
  currentFile?: string;
  phase: 'running' | 'complete' | 'error';
  error?: string;
}

export function useIndexProgress(
  notebookId: NotebookId,
  eventBus: IndexerEventBus
): IndexProgress | null {
  const [progress, setProgress] = useState<IndexProgress | null>(null);

  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(eventBus.on('index:progress', p => {
      if (p.notebookId !== notebookId) return;
      setProgress({ done: p.done, total: p.total, currentFile: p.currentFile, phase: 'running' });
    }));
    offs.push(eventBus.on('index:complete', p => {
      if (p.notebookId !== notebookId) return;
      setProgress(prev => prev ? { ...prev, phase: 'complete', total: p.fileCount } : null);
    }));
    offs.push(eventBus.on('index:error', p => {
      if (p.notebookId !== notebookId) return;
      setProgress(prev => prev ? { ...prev, phase: 'error', error: p.error } : null);
    }));
    return () => offs.forEach(f => f());
  }, [notebookId, eventBus]);

  return progress;
}
