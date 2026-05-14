// src/ui/components/OfficeFormatPicker.tsx
import React from 'react';
import { t } from 'src/i18n';

export const FORMAT_LABELS: Record<string, string> = {
  md:   'Markdown (.md, .txt)',
  docx: 'Word (.docx)',
  pptx: 'PowerPoint (.pptx)',
  xlsx: 'Excel (.xlsx)',
  pdf:  'PDF (.pdf)',
};

/** 所有支持的索引格式(权威列表);新增格式只需在此处加一行。 */
export const ALL_FORMATS = ['md', 'docx', 'pptx', 'xlsx', 'pdf'] as const;

/** 图片扩展名组 — UI 用单一勾选切换全部 */
export const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'bmp', 'gif'] as const;

export interface OfficeFormatPickerProps {
  /** 当前选中的扩展(小写不含点);undefined 视为 ['md'] */
  value: string[] | undefined;
  onChange(next: string[]): void;
}

export function OfficeFormatPicker({ value, onChange }: OfficeFormatPickerProps) {
  const effective = value ?? ['md'];
  const imagesEnabled = IMAGE_FORMATS.some(e => effective.includes(e));

  const toggle = (ext: string) => {
    const isOn = effective.includes(ext);
    if (isOn) {
      if (ext === 'md') return;
      onChange(effective.filter(e => e !== ext));
    } else {
      const next = [...ALL_FORMATS, ...IMAGE_FORMATS].filter(e => effective.includes(e) || e === ext);
      onChange(next);
    }
  };

  const toggleImages = () => {
    if (imagesEnabled) {
      onChange(effective.filter(e => !IMAGE_FORMATS.includes(e as typeof IMAGE_FORMATS[number])));
    } else {
      const next = [...ALL_FORMATS, ...IMAGE_FORMATS].filter(
        e => effective.includes(e) || IMAGE_FORMATS.includes(e as typeof IMAGE_FORMATS[number]),
      );
      onChange(next);
    }
  };

  return (
    <fieldset style={{
      border: '1px solid var(--background-modifier-border)',
      borderRadius: '4px',
      padding: '12px',
      marginBottom: '8px',
    }}>
      <legend style={{ padding: '0 6px', color: 'var(--text-muted)' }}>{t('officeFormat.legend')}</legend>
      {ALL_FORMATS.map(ext => (
        <label key={ext} style={{ display: 'block', marginBottom: '4px' }}>
          <input
            type="checkbox"
            checked={effective.includes(ext)}
            disabled={ext === 'md'}
            onChange={() => toggle(ext)}
          />
          {' '}{FORMAT_LABELS[ext]}
          {ext === 'md' && (
            <span style={{ marginLeft: '6px', color: 'var(--text-muted)', fontSize: '0.85em' }}>
              {t('officeFormat.required')}
            </span>
          )}
        </label>
      ))}
      <label style={{ display: 'block', marginBottom: '4px' }}>
        <input type="checkbox" checked={imagesEnabled} onChange={toggleImages} />
        {' '}{t('officeFormat.images')}
        <span style={{ marginLeft: '6px', color: 'var(--text-muted)', fontSize: '0.85em' }}>
          {t('officeFormat.imagesHint')}
        </span>
      </label>
      <div style={{ marginTop: '6px', color: 'var(--text-muted)', fontSize: '0.85em' }}>
        {t('officeFormat.dirtyHint')}
      </div>
    </fieldset>
  );
}
