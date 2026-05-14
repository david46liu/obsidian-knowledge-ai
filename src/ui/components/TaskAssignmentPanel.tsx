import React, { useEffect, useState } from 'react';
import type { Provider, TaskName, TaskAssignment } from 'src/types/data';

interface TaskAssignmentPanelProps {
  taskAssignments: Partial<Record<TaskName, TaskAssignment>>;
  providers: Provider[];
  onChange(task: TaskName, assignment: TaskAssignment | null): void;
  advanced: boolean;
  onToggleAdvanced(): void;
}

const ACTIVE_TASKS: TaskName[] = ['chat', 'rerank', 'summary', 'vision'];
const INACTIVE_TASKS: TaskName[] = ['embedding', 'tts'];
// TODO(i18n): wire up t()
const TASK_LABELS: Record<TaskName, string> = {
  chat: 'Chat',
  rerank: 'Rerank',
  summary: 'Summary',
  embedding: 'Embedding',
  tts: 'TTS',
  vision: 'Vision',
};

function TaskRow({
  task,
  assignment,
  providers,
  onChange,
  disabled,
}: {
  task: TaskName;
  assignment: TaskAssignment | undefined;
  providers: Provider[];
  onChange: TaskAssignmentPanelProps['onChange'];
  disabled?: boolean;
}) {
  const providerId = assignment?.providerId ?? '';
  const persistedModel = assignment?.model ?? '';
  const [draftModel, setDraftModel] = useState(persistedModel);
  useEffect(() => { setDraftModel(persistedModel); }, [persistedModel]);

  const selectedProvider = providers.find(p => p.id === providerId);
  // TODO(i18n): wire up t()
  const placeholder = selectedProvider
    ? `Default: ${selectedProvider.defaultModel}`
    : 'Model name';

  const handleProviderChange = (pid: string) => {
    if (!pid) { onChange(task, null); return; }
    onChange(task, { ...(assignment ?? { model: '' }), providerId: pid });
  };

  const commitModel = () => {
    if (!providerId) return;
    if (draftModel === persistedModel) return;
    onChange(task, { ...(assignment ?? { providerId }), model: draftModel });
  };

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px', opacity: disabled ? 0.5 : 1 }}>
      <span style={{ minWidth: '80px' }}>{TASK_LABELS[task]}</span>
      <select value={providerId} disabled={disabled} onChange={e => handleProviderChange(e.target.value)} style={{ flex: 1 }}>
        {/* TODO(i18n): wire up t() */}
        <option value="">— Select provider —</option>
        {providers.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
      </select>
      <input
        type="text"
        value={draftModel}
        disabled={disabled || !providerId}
        placeholder={placeholder}
        onChange={e => setDraftModel(e.target.value)}
        onBlur={commitModel}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ flex: 1 }}
      />
    </div>
  );
}

export function TaskAssignmentPanel({
  taskAssignments,
  providers,
  onChange,
  advanced,
  onToggleAdvanced,
}: TaskAssignmentPanelProps) {
  if (!advanced) {
    const chatAssignment = taskAssignments['chat'];
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          {/* TODO(i18n): wire up t() */}
          <span>Main model</span>
          <button onClick={onToggleAdvanced}>Advanced</button>
        </div>
        <TaskRow
          task="chat"
          assignment={chatAssignment}
          providers={providers}
          onChange={onChange}
        />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        {/* TODO(i18n): wire up t() */}
        <span>Task model assignments</span>
        <button onClick={onToggleAdvanced}>Simple mode</button>
      </div>
      {ACTIVE_TASKS.map(task => (
        <TaskRow
          key={task}
          task={task}
          assignment={taskAssignments[task]}
          providers={providers}
          onChange={onChange}
        />
      ))}
      {INACTIVE_TASKS.map(task => (
        <TaskRow
          key={task}
          task={task}
          assignment={taskAssignments[task]}
          providers={providers}
          onChange={onChange}
          disabled
        />
      ))}
    </div>
  );
}
