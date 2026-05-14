import React from 'react';
import type { NotebookTransientFileError } from 'src/types/data';

export interface TransientErrorBarProps {
  errors: NotebookTransientFileError[];
  onRetry(): void;
}

export function TransientErrorBar({ errors, onRetry }: TransientErrorBarProps) {
  if (errors.length === 0) return null;
  return (
    <div style={{
      marginTop: '6px',
      padding: '6px 10px',
      background: 'var(--background-modifier-error-rgb, 255, 100, 100)',
      backgroundColor: 'rgba(255, 100, 100, 0.1)',
      borderLeft: '3px solid var(--background-modifier-error)',
      borderRadius: '3px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '8px',
      fontSize: '0.9em',
    }}>
      <span>
        ⚠ {errors.length} 个文件本次未索引(可重试)
      </span>
      <button
        onClick={onRetry}
        style={{ padding: '2px 10px', fontSize: '0.9em' }}
        title={errors.slice(0, 5).map(e => `${e.path}: ${e.message}`).join('\n')}
      >
        重试
      </button>
    </div>
  );
}
