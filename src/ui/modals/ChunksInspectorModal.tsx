import { App, Modal } from 'obsidian';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { t } from 'src/i18n';
import type { Chunk, NotebookId } from 'src/types/data';
import type { PluginServices } from 'src/ui/hooks/useStore';

export class ChunksInspectorModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly filePath: string,
    private readonly notebookId: NotebookId,
    private readonly services: PluginServices,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t('chunksInspector.title', { path: this.filePath }));
    this.root = createRoot(this.contentEl);
    this.root.render(
      <ChunksInspectorContent
        filePath={this.filePath}
        notebookId={this.notebookId}
        services={this.services}
      />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

interface ContentProps {
  filePath: string;
  notebookId: NotebookId;
  services: PluginServices;
}

function ChunksInspectorContent({ filePath, notebookId, services }: ContentProps) {
  const [state, setState] = React.useState<
    | { kind: 'loading' }
    | { kind: 'no-index' }
    | { kind: 'ok'; chunks: Chunk[]; fileHash: string }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await services.fetchChunksForFile(filePath, notebookId);
        if (cancelled) return;
        if (!data) {
          setState({ kind: 'no-index' });
        } else {
          setState({ kind: 'ok', chunks: data.chunks, fileHash: data.fileHash });
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [filePath, notebookId, services]);

  if (state.kind === 'loading') return <div>{t('common.loading')}</div>;
  if (state.kind === 'no-index') return <div>{t('chunksInspector.notIndexed')}</div>;
  if (state.kind === 'error') return <div style={{ color: 'var(--text-error)' }}>{t('chunksInspector.errorPrefix', { error: state.message })}</div>;

  return (
    <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
      <div style={{ marginBottom: '8px', color: 'var(--text-muted)', fontSize: '0.85em' }}>
        {t('chunksInspector.summary', { count: state.chunks.length, hash: state.fileHash.slice(0, 12) })}
      </div>
      {state.chunks.map((c, i) => (
        <ChunkCard key={i} chunk={c} index={i} />
      ))}
    </div>
  );
}

function ChunkCard({ chunk, index }: { chunk: Chunk; index: number }) {
  const preview = chunk.content.length > 200 ? chunk.content.slice(0, 200) + '…' : chunk.content;
  return (
    <div style={{
      border: '1px solid var(--background-modifier-border)',
      padding: '8px 10px',
      borderRadius: '4px',
      marginBottom: '6px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.85em', marginBottom: '4px' }}>
        <span>#{index} · {chunk.kind} · {chunk.tokenCount} tokens</span>
        <span>{describeLocator(chunk.locator)}</span>
      </div>
      <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-monospace)', fontSize: '0.9em' }}>
        {preview}
      </div>
    </div>
  );
}

function describeLocator(loc: Chunk['locator']): string {
  if (!loc) return '—';
  if (loc.kind === 'slide') {
    const note = loc.isNote ? ' · ' + t('chunksInspector.notes') : '';
    return t('chunksInspector.slide', { index: loc.index }) + (loc.title ? `: ${loc.title}` : '') + note;
  }
  if (loc.kind === 'sheet') {
    const range = loc.rowRange ? ` · ${t('chunksInspector.row', { from: loc.rowRange[0], to: loc.rowRange[1] })}` : '';
    return t('chunksInspector.sheet', { name: loc.name }) + range;
  }
  if (loc.kind === 'page') return t('chunksInspector.page', { from: loc.pageRange[0], to: loc.pageRange[1] });
  return JSON.stringify(loc);
}
