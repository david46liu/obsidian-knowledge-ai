import { Menu, Notice, TFile } from 'obsidian';
import type { PluginServices } from 'src/ui/hooks/useStore';
import type { Notebook, NotebookId } from 'src/types/data';

const SUPPORTED_EXTS = ['md', 'txt', 'docx', 'xlsx', 'pptx', 'pdf'];

export interface FileContextMenuDeps {
  services: PluginServices;
  getNotebooks(): Notebook[];
  getActiveNotebookId(): NotebookId | undefined;
}

export function attachFileContextMenu(
  menu: Menu,
  file: TFile,
  deps: FileContextMenuDeps,
): void {
  const ext = file.extension.toLowerCase();
  if (!SUPPORTED_EXTS.includes(ext)) return;

  const owners = deps.getNotebooks().filter(nb => {
    const exts = nb.fileExtensions ?? ['md'];
    if (!exts.includes(ext)) return false;
    return nb.sources.some(s => {
      if (s.type !== 'folder') return false;
      if (s.enabled === false) return false;
      if (s.path === '/' || s.path === '') return true;
      return file.path === s.path || file.path.startsWith(s.path + '/');
    });
  });

  if (owners.length === 0) return;

  const targetNotebookId = owners.find(nb => nb.id === deps.getActiveNotebookId())?.id
    ?? owners[0].id;

  menu.addItem(item => {
    // TODO(i18n): wire up t()
    item.setTitle('View chunks in Knowledge AI').setIcon('list-tree')
      .onClick(() => {
        deps.services.openChunksInspector(file.path, targetNotebookId);
      });
  });

  menu.addItem(item => {
    // TODO(i18n): wire up t()
    item.setTitle('Re-extract this file').setIcon('refresh-cw')
      .onClick(async () => {
        try {
          await deps.services.invalidateFileHash(file.path);
          // TODO(i18n): wire up t()
          new Notice(`Marked ${file.name} for re-extraction. Effective on next reindex.`);
        } catch (e) {
          // TODO(i18n): wire up t()
          new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
  });
}
