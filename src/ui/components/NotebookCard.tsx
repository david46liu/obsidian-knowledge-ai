import React, { useEffect, useState } from 'react';
import type { Notebook, NotebookId } from 'src/types/data';
import type { IndexerEventBus } from 'src/indexer/events';
import { useIndexProgress } from 'src/ui/hooks/useIndexProgress';
import { TransientErrorBar } from 'src/ui/components/TransientErrorBar';
import { PersistentErrorBar } from 'src/ui/components/PersistentErrorBar';
import { usePluginServices } from 'src/ui/hooks/useStore';
import { t } from 'src/i18n';

interface NotebookCardProps {
  notebook: Notebook;
  onOpen(id: NotebookId): void;
  onReindex(id: NotebookId): void;
  onEdit(notebook: Notebook): void;
  onDelete(id: NotebookId): void;
  eventBus: IndexerEventBus;
}

const STATUS_BADGE: Record<string, string> = {
  idle: '✓',
  dirty: '●',
  indexing: '⟳',
  error: '✗',
};

export function NotebookCard({ notebook, onOpen, onReindex, onEdit, onDelete, eventBus }: NotebookCardProps) {
  const progress = useIndexProgress(notebook.id, eventBus);

  return (
    <div style={{ border: '1px solid var(--background-modifier-border)', padding: '8px', marginBottom: '8px', borderRadius: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{notebook.name}</strong>
          <span style={{ marginLeft: '8px' }}>{STATUS_BADGE[notebook.status] ?? notebook.status}</span>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
            {notebook.sources[0]?.path}
            {notebook.stats && (
              <span> · {t('notebook.statsFiles', { count: notebook.stats.fileCount })} · {t('notebook.statsChunks', { count: notebook.stats.chunkCount })}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={() => onOpen(notebook.id)}>{t('notebook.action.open')}</button>
          <button onClick={() => onReindex(notebook.id)}>{t('notebook.action.reindex')}</button>
          <button onClick={() => onEdit(notebook)}>{t('notebook.action.edit')}</button>
          <button onClick={() => { if (window.confirm(t('notebook.deleteConfirm', { name: notebook.name }))) onDelete(notebook.id); }}>
            {t('notebook.action.delete')}
          </button>
        </div>
      </div>
      {progress?.phase === 'running' && (
        <div style={{ marginTop: '4px' }}>
          <div style={{ height: '4px', background: 'var(--background-modifier-border)', borderRadius: '2px' }}>
            <div
              style={{
                height: '100%',
                width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%',
                background: 'var(--interactive-accent)',
                borderRadius: '2px',
                transition: 'width 0.2s',
              }}
            />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8em', marginTop: '2px' }}>
            {progress.done}/{progress.total} {progress.currentFile}
          </div>
        </div>
      )}
      {(notebook.transientFileErrors?.length ?? 0) > 0 && progress?.phase !== 'running' && (
        <TransientErrorBar
          errors={notebook.transientFileErrors!}
          onRetry={() => onReindex(notebook.id)}
        />
      )}
      {(notebook.persistentFileErrors?.length ?? 0) > 0 && progress?.phase !== 'running' && (
        <PersistentErrorBar errors={notebook.persistentFileErrors!} />
      )}
      <SummarySection notebookId={notebook.id} eventBus={eventBus} />
    </div>
  );
}

interface SummaryState {
  done: number;
  failed: number;
  total: number;
  inFlight: number;
  skipped: number;
  phase: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  lastError?: string;
  cancel?: () => void;
}

function SummarySection({ notebookId, eventBus }: { notebookId: NotebookId; eventBus: IndexerEventBus }) {
  const services = usePluginServices();
  const [coverage, setCoverage] = useState<{ total: number; withSummary: number } | null>(null);
  const [state, setState] = useState<SummaryState>({ done: 0, failed: 0, total: 0, inFlight: 0, skipped: 0, phase: 'idle' });
  const [concurrency, setConcurrency] = useState(1);

  // 订阅进度
  useEffect(() => {
    const off = eventBus.on('summary:progress', p => {
      if (p.notebookId !== notebookId) return;
      setState(prev => ({
        ...prev,
        done: p.done, failed: p.failed, total: p.total, inFlight: p.inFlight,
        skipped: p.skipped ?? prev.skipped,
        lastError: p.lastError ?? prev.lastError,
        phase: prev.phase === 'idle' ? 'running' : prev.phase,
      }));
    });
    return off;
  }, [notebookId, eventBus]);

  // 拉一次覆盖率
  const refreshCoverage = React.useCallback(async () => {
    if (!services.getSummaryCoverage) return;
    try {
      setCoverage(await services.getSummaryCoverage(notebookId));
    } catch { /* ignore */ }
  }, [services, notebookId]);

  useEffect(() => { void refreshCoverage(); }, [refreshCoverage]);

  const start = () => {
    if (!services.backfillSummaries) return;
    const { cancel, promise } = services.backfillSummaries(notebookId, { concurrency });
    setState({ done: 0, failed: 0, total: 0, inFlight: 0, skipped: 0, phase: 'running', cancel });
    void promise
      .then(r => {
        setState(prev => ({ ...prev, phase: 'done', done: prev.done, failed: r.failed, total: r.total }));
        void refreshCoverage();
      })
      .catch((e: unknown) => {
        setState(prev => ({ ...prev, phase: 'error', error: e instanceof Error ? e.message : String(e) }));
      });
  };

  const isRunning = state.phase === 'running';
  const pct = state.total > 0 ? (state.done / state.total) * 100 : 0;

  // 没有 backfillSummaries 服务(降级版本) — 不渲染
  if (!services.backfillSummaries) return null;

  return (
    <div style={{ marginTop: '6px', fontSize: '0.85em', color: 'var(--text-muted)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>
          {t('notebook.summary.label')} {coverage ? t('notebook.summary.fraction', { covered: coverage.withSummary, total: coverage.total }) : t('notebook.summary.loading')}
        </span>
        {isRunning
          ? <button onClick={() => state.cancel?.()}>{t('notebook.summary.cancel')}</button>
          : <>
              <button onClick={start} disabled={!coverage || coverage.total === coverage.withSummary}>
                {coverage && coverage.total > coverage.withSummary ? t('notebook.summary.backfill') : t('notebook.summary.allCovered')}
              </button>
              <label title={t('notebook.summary.concurrencyTitle')}>
                {t('notebook.summary.concurrency')} <input
                  type="number"
                  min={1}
                  max={8}
                  value={concurrency}
                  onChange={e => setConcurrency(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
                  style={{ width: '40px' }}
                />
              </label>
            </>
        }
        {state.phase === 'done' && (
          <span>{t('notebook.summary.done', { failed: state.failed })}</span>
        )}
        {state.phase === 'error' && (
          <span style={{ color: 'var(--color-red)' }}>{t('notebook.summary.errorPrefix', { error: state.error ?? '' })}</span>
        )}
      </div>
      {isRunning && (
        <div style={{ marginTop: '4px' }}>
          <div style={{ height: '4px', background: 'var(--background-modifier-border)', borderRadius: '2px' }}>
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: 'var(--interactive-accent)',
                borderRadius: '2px',
                transition: 'width 0.2s',
              }}
            />
          </div>
          <div style={{ fontSize: '0.8em', marginTop: '2px' }}>
            {t('notebook.summary.runningStats', {
              done: state.done,
              total: state.total,
              inFlight: state.inFlight,
              failed: state.failed,
            })}{state.skipped > 0 ? t('notebook.summary.skippedSuffix', { skipped: state.skipped }) : ''}
          </div>
        </div>
      )}
      {(state.failed > 0 || state.phase === 'error') && (
        <div style={{
          marginTop: '4px',
          padding: '4px 8px',
          fontSize: '0.8em',
          background: 'var(--background-modifier-error)',
          color: 'var(--text-error)',
          borderRadius: '4px',
          wordBreak: 'break-all',
        }}>
          {state.lastError && state.lastError.trim()
            ? t('notebook.summary.lastError', { error: state.lastError })
            : t('notebook.summary.lastErrorEmpty')}
        </div>
      )}
    </div>
  );
}
