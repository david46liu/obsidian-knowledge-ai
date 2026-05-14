// src/ui/menus/ribbonContextMenu.ts
import { Menu, Notice } from 'obsidian';
import { t } from 'src/i18n';
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
      item.setTitle(t('ribbonMenu.empty')).setDisabled(true)
    );
  } else {
    menu.addItem(item =>
      item.setTitle(t('ribbonMenu.activeHeader')).setIsLabel(true)
    );
    for (const nb of notebooks) {
      menu.addItem(item =>
        item.setTitle(nb.name)
          .setIcon(nb.id === activeId ? 'check' : '')
          .onClick(() => {
            deps.setActiveNotebookId(nb.id);
            new Notice(t('ribbonMenu.switchedTo', { name: nb.name }));
          })
      );
    }
    menu.addSeparator();
    menu.addItem(item => {
      item.setTitle(t('ribbonMenu.reindexActive'))
        .setIcon('refresh-cw');
      if (!activeId) item.setDisabled(true);
      else item.onClick(() => {
        deps.services.reindex(activeId).catch(e =>
          new Notice(t('ribbonMenu.reindexFailed', { error: e instanceof Error ? e.message : String(e) }))
        );
      });
    });
    menu.addItem(item =>
      item.setTitle(t('ribbonMenu.reindexAll')).setIcon('refresh-ccw')
        .onClick(() => deps.reindexAll())
    );
  }

  // I4 (per spec §8.3):打开 Settings tab
  menu.addSeparator();
  menu.addItem(item =>
    item.setTitle(t('ribbonMenu.settings')).setIcon('settings')
      .onClick(() => deps.openSettings())
  );

  menu.showAtMouseEvent(evt);
}
