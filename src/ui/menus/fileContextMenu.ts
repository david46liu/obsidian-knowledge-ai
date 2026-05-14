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
    item.setTitle('在 Notebook AI 查看 chunks').setIcon('list-tree')
      .onClick(() => {
        deps.services.openChunksInspector(file.path, targetNotebookId);
      });
  });

  menu.addItem(item => {
    item.setTitle('重新提取此文件').setIcon('refresh-cw')
      .onClick(async () => {
        try {
          await deps.services.invalidateFileHash(file.path);
          new Notice(`已标记 ${file.name} 重新提取,下次重索引时生效`);
        } catch (e) {
          new Notice(`失败:${e instanceof Error ? e.message : String(e)}`);
        }
      });
  });
}
