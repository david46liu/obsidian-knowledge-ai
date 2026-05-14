import type { App } from 'obsidian';
import type { Notebook } from 'src/types/data';

/**
 * Adds CSS class `notebook-ai-indexed-folder` to file-explorer folder titles
 * whose `data-path` matches one of the notebook source folder paths.
 *
 * Top-level only — does not mark sub-folders or files. Re-applies via
 * MutationObserver to handle folder expand/collapse and file-explorer reloads.
 */
export class FolderMarkers {
  private static readonly CLASS = 'notebook-ai-indexed-folder';
  private observer: MutationObserver | null = null;
  private sourcePaths = new Set<string>();
  private rafHandle: number | null = null;

  constructor(private readonly app: App) {}

  start(notebooks: Notebook[]): void {
    this.updateFromNotebooks(notebooks);
    this.observer = new MutationObserver(() => this.scheduleApply());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.scheduleApply();
  }

  updateFromNotebooks(notebooks: Notebook[]): void {
    const paths = new Set<string>();
    for (const nb of notebooks) {
      for (const src of nb.sources) {
        if (src.type === 'folder' && src.path) paths.add(src.path);
      }
    }
    this.sourcePaths = paths;
    this.scheduleApply();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    document.querySelectorAll(`.${FolderMarkers.CLASS}`).forEach(el => {
      el.classList.remove(FolderMarkers.CLASS);
    });
  }

  private scheduleApply(): void {
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.apply();
    });
  }

  private apply(): void {
    document.querySelectorAll('.nav-folder-title').forEach(el => {
      const path = el.getAttribute('data-path');
      const shouldMark = !!path && this.sourcePaths.has(path);
      el.classList.toggle(FolderMarkers.CLASS, shouldMark);
    });
  }
}
