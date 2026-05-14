import React, { useState } from 'react';
import type { NotebookPersistentFileError } from 'src/types/data';

export interface PersistentErrorBarProps {
  errors: NotebookPersistentFileError[];
}

export function PersistentErrorBar({ errors }: PersistentErrorBarProps) {
  const [expanded, setExpanded] = useState(false);
  if (errors.length === 0) return null;
  return (
    <div style={{
      marginTop: '6px',
      padding: '6px 10px',
      backgroundColor: 'rgba(255, 165, 0, 0.1)',
      borderLeft: '3px solid var(--color-orange, #d97706)',
      borderRadius: '3px',
      fontSize: '0.9em',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span>
          ⛔ {errors.length} 个文件解析失败(重试无效,需修复源文件)
        </span>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ padding: '2px 10px', fontSize: '0.9em' }}
        >
          {expanded ? '收起' : '查看'}
        </button>
      </div>
      {expanded && (
        <ul style={{
          margin: '6px 0 0 0',
          paddingLeft: '18px',
          color: 'var(--text-muted)',
          fontSize: '0.85em',
        }}>
          {errors.map((e, i) => (
            <li key={i} style={{ marginBottom: '2px' }}>
              <code>{e.path}</code> — {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
