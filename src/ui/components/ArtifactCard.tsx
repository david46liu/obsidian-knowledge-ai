import React, { useState } from 'react';
import type { Artifact } from 'src/types/artifact';

interface Props {
  artifact: Artifact;
  active?: boolean;
  onOpen(a: Artifact): void;
  onDelete(a: Artifact): void;
  onExport(a: Artifact): Promise<{ vaultPath: string }>;
}

// TODO(i18n): wire up t()
const KIND_LABEL: Record<Artifact['kind'], string> = {
  'summary': 'Summary',
  'study-guide': 'Study guide',
  'timeline': 'Timeline',
  'faq': 'FAQ',
  'briefing': 'Briefing',
  'mind-map': 'Mind map',
  'ppt': 'Slide deck',
};

export function ArtifactCard({ artifact, active, onOpen, onDelete, onExport }: Props) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (exporting) return;
    setExporting(true);
    try {
      const { vaultPath } = await onExport(artifact);
      // eslint-disable-next-line no-alert
      // TODO(i18n): wire up t()
      alert(`Exported to ${vaultPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-alert
      // TODO(i18n): wire up t()
      alert(`Export failed: ${msg}`);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    // eslint-disable-next-line no-alert
    // TODO(i18n): wire up t()
    if (confirm(`Delete "${artifact.title}"?`)) {
      onDelete(artifact);
    }
  };

  return (
    <div
      onClick={() => onOpen(artifact)}
      style={{
        padding: '8px 10px',
        marginBottom: '6px',
        borderRadius: '6px',
        cursor: 'pointer',
        background: active ? 'var(--background-modifier-hover)' : 'var(--background-secondary)',
        border: active ? '1px solid var(--interactive-accent)' : '1px solid transparent',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
        <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {artifact.title}
        </strong>
        <small style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{KIND_LABEL[artifact.kind] ?? artifact.kind}</small>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
        <small style={{ color: 'var(--text-muted)' }}>
          {new Date(artifact.generatedAt).toLocaleString()}
          {artifact.truncated && (
            /* TODO(i18n): wire up t() */
            <span
              style={{ color: 'var(--color-orange)', marginLeft: '6px', cursor: 'help' }}
              title="Source documents were truncated (only the leading portion was sent to the LLM). The output itself is complete. Narrow the notebook scope for fuller coverage."
            >
              (sources truncated)
            </span>
          )}
        </small>
        <div style={{ display: 'flex', gap: '4px' }}>
          {/* TODO(i18n): wire up t() */}
          <button onClick={handleExport} disabled={exporting} title="Export to vault">
            {exporting ? 'Exporting…' : 'Export'}
          </button>
          {/* TODO(i18n): wire up t() */}
          <button onClick={handleDelete} title="Delete">Delete</button>
        </div>
      </div>
    </div>
  );
}
