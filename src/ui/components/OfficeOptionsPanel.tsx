// src/ui/components/OfficeOptionsPanel.tsx
import React from 'react';
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
      // TODO(i18n): wire up t()
      const ok = window.confirm(
        'Enabling this will index speaker notes from all .pptx files, which may then be cited in AI answers. Continue?'
      );
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
      {/* TODO(i18n): wire up t() */}
      <legend style={{ padding: '0 6px', color: 'var(--text-muted)' }}>Office parsing options</legend>
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
        {/* TODO(i18n): wire up t() */}
        {' '}Include PowerPoint speaker notes
      </label>
      {/* TODO(i18n): wire up t() */}
      <div style={{
        marginLeft: '20px',
        marginTop: '4px',
        color: 'var(--text-muted)',
        fontSize: '0.85em',
      }}>
        ⚠ Speaker notes often contain private content. When enabled they are indexed by RAG and sent to the LLM. Off by default.
        {!pptxEnabled && ' (Enable the PowerPoint format first.)'}
      </div>
    </fieldset>
  );
}
