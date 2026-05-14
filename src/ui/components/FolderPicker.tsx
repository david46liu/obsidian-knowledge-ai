import React from 'react';
import { t } from 'src/i18n';

interface FolderPickerProps {
  value: string;
  folders: string[];
  onChange(path: string): void;
  disabled?: boolean;
}

export function FolderPicker({ value, folders, onChange, disabled }: FolderPickerProps) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      style={{ width: '100%' }}
    >
      <option value="">{t('folderPicker.empty')}</option>
      {folders.map(f => <option key={f} value={f}>{f}</option>)}
    </select>
  );
}
