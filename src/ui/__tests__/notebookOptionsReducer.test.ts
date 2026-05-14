// src/ui/__tests__/notebookOptionsReducer.test.ts
import { describe, it, expect } from 'vitest';
import {
  type NotebookOptionsState,
  initialOptionsState,
  toggleExtension,
  setOfficeOptions,
} from '../notebookOptionsReducer';

describe('notebookOptionsReducer', () => {
  it('initialOptionsState 从 undefined fallback 到 ["md"]', () => {
    const s = initialOptionsState({ fileExtensions: undefined, officeOptions: undefined });
    expect(s.fileExtensions).toEqual(['md']);
    expect(s.officeOptions).toEqual({ includePptxNotes: false });
  });

  it('initialOptionsState 保留已有 fileExtensions / officeOptions', () => {
    const s = initialOptionsState({
      fileExtensions: ['md', 'docx'],
      officeOptions: { includePptxNotes: true },
    });
    expect(s.fileExtensions).toEqual(['md', 'docx']);
    expect(s.officeOptions).toEqual({ includePptxNotes: true });
  });

  it('toggleExtension 加入新格式,顺序按 [md, docx, pptx, xlsx] 稳定', () => {
    const s: NotebookOptionsState = { fileExtensions: ['md'], officeOptions: { includePptxNotes: false } };
    expect(toggleExtension(s, 'pptx').fileExtensions).toEqual(['md', 'pptx']);
    expect(toggleExtension({ ...s, fileExtensions: ['md', 'pptx'] }, 'docx').fileExtensions)
      .toEqual(['md', 'docx', 'pptx']);
  });

  it('toggleExtension 移除格式,但 md 不可移除', () => {
    const s: NotebookOptionsState = { fileExtensions: ['md', 'docx', 'pptx'], officeOptions: { includePptxNotes: false } };
    expect(toggleExtension(s, 'docx').fileExtensions).toEqual(['md', 'pptx']);
    expect(toggleExtension(s, 'md').fileExtensions).toEqual(['md', 'docx', 'pptx']); // no-op
  });

  it('toggleExtension 移除 pptx 时自动关 includePptxNotes', () => {
    const s: NotebookOptionsState = {
      fileExtensions: ['md', 'pptx'],
      officeOptions: { includePptxNotes: true },
    };
    const next = toggleExtension(s, 'pptx');
    expect(next.fileExtensions).toEqual(['md']);
    expect(next.officeOptions.includePptxNotes).toBe(false);
  });

  it('setOfficeOptions 替换整个 officeOptions 对象', () => {
    const s: NotebookOptionsState = { fileExtensions: ['md', 'pptx'], officeOptions: { includePptxNotes: false } };
    const next = setOfficeOptions(s, { includePptxNotes: true });
    expect(next.officeOptions).toEqual({ includePptxNotes: true });
    expect(next.fileExtensions).toEqual(['md', 'pptx']); // 不动
  });
});
