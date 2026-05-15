import React, { useEffect, useState } from 'react';
import { Notice } from 'obsidian';
import { t } from 'src/i18n';
import type { Artifact } from 'src/types/artifact';

interface Props {
  artifact: Artifact;
  active?: boolean;
  onOpen(a: Artifact): void;
  onDelete(a: Artifact): void;
  onExport(a: Artifact): Promise<{ vaultPath: string }>;
}

const KIND_LABEL_KEYS: Record<Artifact['kind'], string> = {
  'summary': 'artifactCard.kind.summary',
  'study-guide': 'artifactCard.kind.studyGuide',
  'timeline': 'artifactCard.kind.timeline',
  'faq': 'artifactCard.kind.faq',
  'briefing': 'artifactCard.kind.briefing',
  'mind-map': 'artifactCard.kind.mindMap',
  'ppt': 'artifactCard.kind.ppt',
};

const DELETE_CONFIRM_TIMEOUT_MS = 4000;

export function ArtifactCard({ artifact, active, onOpen, onDelete, onExport }: Props) {
  const [exporting, setExporting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const id = window.setTimeout(() => setConfirmingDelete(false), DELETE_CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [confirmingDelete]);

  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (exporting) return;
    setExporting(true);
    try {
      const { vaultPath } = await onExport(artifact);
      new Notice(t('artifact.exportedTo', { path: vaultPath }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(t('artifact.exportFailed', { error: msg }));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    onDelete(artifact);
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
        <small style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
          {KIND_LABEL_KEYS[artifact.kind] ? t(KIND_LABEL_KEYS[artifact.kind]) : artifact.kind}
        </small>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
        <small style={{ color: 'var(--text-muted)' }}>
          {new Date(artifact.generatedAt).toLocaleString()}
          {artifact.truncated && (
            <span
              style={{ color: 'var(--color-orange)', marginLeft: '6px', cursor: 'help' }}
              title={t('artifactCard.truncatedTitle')}
            >
              {t('artifactCard.truncatedTag')}
            </span>
          )}
        </small>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={handleExport} disabled={exporting} title={t('artifactCard.exportTitle')}>
            {exporting ? t('common.exporting') : t('common.export')}
          </button>
          <button
            onClick={handleDelete}
            title={confirmingDelete ? t('artifactCard.confirmDelete') : t('artifact.deleteConfirm', { title: artifact.title })}
          >
            {confirmingDelete ? t('artifactCard.confirmDelete') : t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
