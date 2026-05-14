// src/ui/components/OfficeOptionsPanel.tsx
import React from 'react';
import { t } from 'src/i18n';
import type { NotebookOfficeOptions } from 'src/types/data';

export interface OfficeOptionsPanelProps {
  /** undefined 视为 { includePptxNotes: false } */
  value: NotebookOfficeOptions | undefined;
  /** 当前选中的 fileExtensions —— 用于决定 includePptxNotes 是否 disabled */
  fileExtensions: string[] | undefined;
  onChange(next: NotebookOfficeOptions): void;
}

export function OfficeOptionsPanel({ value, fileExtensions, onChange }: OfficeOptionsPanelProps) {
  const includeNotes = value?.includePptxNotes === true;
  const pptxEnabled = (fileExtensions ?? ['md']).includes('pptx');

  const toggleNotes = () => {
    const next = !includeNotes;
    if (next) {
      const ok = window.confirm(t('officeOptions.notesConfirm'));
      if (!ok) return;
    }
    onChange({ ...(value ?? {}), includePptxNotes: next });
  };

  return (
    <fieldset style={{
      border: '1px solid var(--background-modifier-border)',
      borderRadius: '4px',
      padding: '12px',
      marginBottom: '8px',
    }}>
      <legend style={{ padding: '0 6px', color: 'var(--text-muted)' }}>{t('officeOptions.legend')}</legend>
      <label style={{
        display: 'block',
        marginBottom: '4px',
        opacity: pptxEnabled ? 1 : 0.5,
      }}>
        <input
          type="checkbox"
          checked={includeNotes}
          disabled={!pptxEnabled}
          onChange={toggleNotes}
        />
        {' '}{t('officeOptions.includeNotes')}
      </label>
      <div style={{
        marginLeft: '20px',
        marginTop: '4px',
        color: 'var(--text-muted)',
        fontSize: '0.85em',
      }}>
        {t('officeOptions.notesHint')}
        {!pptxEnabled && ' ' + t('officeOptions.enablePptxFirst')}
      </div>
    </fieldset>
  );
}
