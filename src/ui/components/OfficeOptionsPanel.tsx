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
      const ok = window.confirm(
        '启用后所有 .pptx 备注都将被索引,可能在 AI 回答中被引用。确认?'
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
      <legend style={{ padding: '0 6px', color: 'var(--text-muted)' }}>Office 解析选项</legend>
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
        {' '}包含 PowerPoint 演讲者备注
      </label>
      <div style={{
        marginLeft: '20px',
        marginTop: '4px',
        color: 'var(--text-muted)',
        fontSize: '0.85em',
      }}>
        ⚠ 备注常含未公开内容,启用后会被 RAG 检索并发送至 LLM。默认关闭。
        {!pptxEnabled && ' (须先勾选 PowerPoint 格式)'}
      </div>
    </fieldset>
  );
}
