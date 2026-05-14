import React, { useState } from 'react';
import type { Artifact } from 'src/types/artifact';

interface Props {
  artifact: Artifact;
  active?: boolean;
  onOpen(a: Artifact): void;
  onDelete(a: Artifact): void;
  onExport(a: Artifact): Promise<{ vaultPath: string }>;
}

const KIND_LABEL: Record<Artifact['kind'], string> = {
  'summary': '摘要',
  'study-guide': '学习指南',
  'timeline': '时间线',
  'faq': 'FAQ',
  'briefing': '简报',
  'mind-map': '思维导图',
  'ppt': 'PPT 幻灯片',
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
      alert(`已导出到 ${vaultPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-alert
      alert(`导出失败: ${msg}`);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    // eslint-disable-next-line no-alert
    if (confirm(`删除「${artifact.title}」?`)) {
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
            <span
              style={{ color: 'var(--color-orange)', marginLeft: '6px', cursor: 'help' }}
              title="资料源被截断(只喂了前部分文档给 LLM),输出本身完整。如想覆盖更全,可缩小 notebook 范围。"
            >
              (资料截断)
            </span>
          )}
        </small>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={handleExport} disabled={exporting} title="导出到 vault">
            {exporting ? '导出中' : '导出'}
          </button>
          <button onClick={handleDelete} title="删除">删除</button>
        </div>
      </div>
    </div>
  );
}
