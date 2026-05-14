import React from 'react';
import type { ArtifactKind } from 'src/types/artifact';
import { GENERATORS } from 'src/generation/generators';

interface Props {
  disabled?: boolean;
  streamingKind?: ArtifactKind | null;
  onGenerate(kind: ArtifactKind): void;
  onCancel?(): void;
}

// 动态遍历 GENERATORS,新增 generator(如 mind-map)自动出现在菜单
const ITEMS = (Object.keys(GENERATORS) as ArtifactKind[]).map(kind => ({
  kind,
  label: GENERATORS[kind].displayName,
}));

export function GenerateMenu({ disabled, streamingKind, onGenerate, onCancel }: Props) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
      {ITEMS.map(it => {
        const isCurrent = streamingKind === it.kind;
        return (
          <button
            key={it.kind}
            onClick={() => onGenerate(it.kind)}
            disabled={disabled || !!streamingKind}
            title={isCurrent ? '生成中...' : `生成${it.label}`}
          >
            {isCurrent ? `${it.label}...` : it.label}
          </button>
        );
      })}
      {streamingKind && onCancel && (
        <button onClick={onCancel} style={{ marginLeft: 'auto' }}>取消</button>
      )}
    </div>
  );
}
