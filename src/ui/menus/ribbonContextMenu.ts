// src/ui/menus/ribbonContextMenu.ts
import { Menu, Notice } from 'obsidian';
import type { PluginServices } from 'src/ui/hooks/useStore';
import type { Notebook, NotebookId } from 'src/types/data';

export interface RibbonContextMenuDeps {
  services: PluginServices;
  getNotebooks(): Notebook[];
  getActiveNotebookId(): NotebookId | undefined;
  setActiveNotebookId(id: NotebookId): void;
  reindexAll(): void;          // fire-and-forget,见 I5
  openSettings(): void;        // I4 spec §8.3 "⚙ 设置"
}

export function showRibbonContextMenu(
  evt: MouseEvent,
  deps: RibbonContextMenuDeps,
): void {
  const menu = new Menu();
  const notebooks = deps.getNotebooks();
  const activeId = deps.getActiveNotebookId();

  if (notebooks.length === 0) {
    menu.addItem(item =>
      // TODO(i18n): wire up t()
      item.setTitle('(No notebooks yet)').setDisabled(true)
    );
  } else {
    menu.addItem(item =>
      // TODO(i18n): wire up t()
      item.setTitle('📓 Active Notebook').setIsLabel(true)
    );
    for (const nb of notebooks) {
      menu.addItem(item =>
        item.setTitle(nb.name)
          .setIcon(nb.id === activeId ? 'check' : '')
          .onClick(() => {
            deps.setActiveNotebookId(nb.id);
            // TODO(i18n): wire up t()
            new Notice(`Switched to ${nb.name}`);
          })
      );
    }
    menu.addSeparator();
    menu.addItem(item => {
      // TODO(i18n): wire up t()
      item.setTitle('⚙ Reindex active Notebook')
        .setIcon('refresh-cw');
      if (!activeId) item.setDisabled(true);
      else item.onClick(() => {
        deps.services.reindex(activeId).catch(e =>
          // TODO(i18n): wire up t()
          new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`)
        );
      });
    });
    menu.addItem(item =>
      // TODO(i18n): wire up t()
      item.setTitle('🌐 Reindex all Notebooks').setIcon('refresh-ccw')
        .onClick(() => deps.reindexAll())
    );
  }

  // I4 (per spec §8.3):打开 Settings tab
  menu.addSeparator();
  menu.addItem(item =>
    // TODO(i18n): wire up t()
    item.setTitle('⚙ Settings').setIcon('settings')
      .onClick(() => deps.openSettings())
  );

  menu.showAtMouseEvent(evt);
}
