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
      item.setTitle('(尚无 Notebook)').setDisabled(true)
    );
  } else {
    menu.addItem(item =>
      item.setTitle('📓 当前 Notebook').setIsLabel(true)
    );
    for (const nb of notebooks) {
      menu.addItem(item =>
        item.setTitle(nb.name)
          .setIcon(nb.id === activeId ? 'check' : '')
          .onClick(() => {
            deps.setActiveNotebookId(nb.id);
            new Notice(`切换到 ${nb.name}`);
          })
      );
    }
    menu.addSeparator();
    menu.addItem(item => {
      item.setTitle('⚙ 重新索引当前 Notebook')
        .setIcon('refresh-cw');
      if (!activeId) item.setDisabled(true);
      else item.onClick(() => {
        deps.services.reindex(activeId).catch(e =>
          new Notice(`失败:${e instanceof Error ? e.message : String(e)}`)
        );
      });
    });
    menu.addItem(item =>
      item.setTitle('🌐 重新索引全部 Notebook').setIcon('refresh-ccw')
        .onClick(() => deps.reindexAll())
    );
  }

  // I4 (per spec §8.3):打开 Settings tab
  menu.addSeparator();
  menu.addItem(item =>
    item.setTitle('⚙ 设置').setIcon('settings')
      .onClick(() => deps.openSettings())
  );

  menu.showAtMouseEvent(evt);
}
