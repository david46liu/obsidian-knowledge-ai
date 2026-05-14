// src/ui/notebookOptionsReducer.ts
import type { NotebookOfficeOptions } from 'src/types/data';

const ALL_FORMATS = ['md', 'docx', 'pptx', 'xlsx'] as const;

export interface NotebookOptionsState {
  fileExtensions: string[];
  officeOptions: NotebookOfficeOptions;
}

export interface NotebookOptionsInput {
  fileExtensions: string[] | undefined;
  officeOptions: NotebookOfficeOptions | undefined;
}

export function initialOptionsState(input: NotebookOptionsInput): NotebookOptionsState {
  return {
    fileExtensions: input.fileExtensions ?? ['md'],
    officeOptions: input.officeOptions ?? { includePptxNotes: false },
  };
}

export function toggleExtension(state: NotebookOptionsState, ext: string): NotebookOptionsState {
  if (ext === 'md') return state; // md 必选,不可 toggle off

  const isOn = state.fileExtensions.includes(ext);
  let nextExtensions: string[];
  if (isOn) {
    nextExtensions = state.fileExtensions.filter(e => e !== ext);
  } else {
    // 按 ALL_FORMATS 顺序插入,保持稳定
    nextExtensions = ALL_FORMATS.filter(e => state.fileExtensions.includes(e) || e === ext);
  }

  // 移除 pptx 时自动关 includePptxNotes(避免遗留 stale opt)
  let nextOpts = state.officeOptions;
  if (ext === 'pptx' && isOn && state.officeOptions.includePptxNotes) {
    nextOpts = { ...state.officeOptions, includePptxNotes: false };
  }

  return { fileExtensions: nextExtensions, officeOptions: nextOpts };
}

export function setOfficeOptions(
  state: NotebookOptionsState,
  next: NotebookOfficeOptions,
): NotebookOptionsState {
  return { ...state, officeOptions: next };
}
