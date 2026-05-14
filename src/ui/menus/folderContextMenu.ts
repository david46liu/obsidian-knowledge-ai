// src/ui/menus/folderContextMenu.ts
import { App, Menu, Notice, TFolder } from 'obsidian';
import type { PluginServices } from 'src/ui/hooks/useStore';
import type { Notebook } from 'src/types/data';
import { NotebookFromFolderModal } from 'src/ui/modals/NotebookFromFolderModal';

export interface FolderContextMenuDeps {
  app: App;
  services: PluginServices;
  /** 同步读 notebooks(从 zustand store snapshot) */
  getNotebooks(): Notebook[];
}

export function attachFolderContextMenu(
  menu: Menu,
  folder: TFolder,
  deps: FolderContextMenuDeps,
): void {
  const allNotebooks = deps.getNotebooks();
  const folderPath = folder.path;

  const referencingNotebooks = allNotebooks.filter(nb =>
    nb.sources.some(s => s.type === 'folder' && s.path === folderPath)
  );

  // 1. 添加为 Notebook 源
  menu.addItem(item => {
    // TODO(i18n): wire up t()
    item.setTitle('Add as Notebook source').setIcon('folder-plus');
    if (allNotebooks.length === 0) {
      item.setDisabled(true);
      return;
    }
    // I3: setSubmenu 在 obsidian.d.ts 1.12 中可能缺失,用局部类型断言运行时判断
    const maybe = item as unknown as { setSubmenu?: () => Menu };
    if (typeof maybe.setSubmenu === 'function') {
      const sub = maybe.setSubmenu();
      for (const nb of allNotebooks) {
        const isAlreadySource = referencingNotebooks.some(r => r.id === nb.id);
        sub.addItem(it => {
          it.setTitle(nb.name);
          if (isAlreadySource) it.setDisabled(true);
          it.onClick(() => addFolderAsSource(nb, folderPath, deps));
        });
      }
    } else {
      // Fallback: flat 列出每个 notebook 一项(老 Obsidian)
      item.onClick(() => {
        // TODO(i18n): wire up t()
        new Notice('This Obsidian version does not support submenus — add the source from Settings.');
      });
    }
  });

  // 2. 新建 Notebook 用此文件夹
  menu.addItem(item => {
    // TODO(i18n): wire up t()
    item.setTitle('New Notebook from this folder').setIcon('folder-symlink')
      .onClick(() => {
        new NotebookFromFolderModal(deps.app, folderPath, deps.services).open();
      });
  });

  // 3. 打开 Notebook(仅当被引用时显示)
  if (referencingNotebooks.length === 1) {
    menu.addItem(item => {
      // TODO(i18n): wire up t()
      item.setTitle(`Open "${referencingNotebooks[0].name}"`).setIcon('book-open')
        .onClick(() => {
          deps.services.openChatView(referencingNotebooks[0].id).catch(e =>
            // TODO(i18n): wire up t()
            new Notice(`Open failed: ${e instanceof Error ? e.message : String(e)}`)
          );
        });
    });
  } else if (referencingNotebooks.length > 1) {
    menu.addItem(item => {
      // TODO(i18n): wire up t()
      item.setTitle('Open Notebook').setIcon('book-open');
      const maybe = item as unknown as { setSubmenu?: () => Menu };
      if (typeof maybe.setSubmenu === 'function') {
        const sub = maybe.setSubmenu();
        for (const nb of referencingNotebooks) {
          sub.addItem(it => {
            it.setTitle(nb.name).onClick(() => {
              deps.services.openChatView(nb.id).catch(e =>
                // TODO(i18n): wire up t()
                new Notice(`Open failed: ${e instanceof Error ? e.message : String(e)}`)
              );
            });
          });
        }
      } else {
        item.onClick(() => {
          deps.services.openChatView(referencingNotebooks[0].id).catch(e =>
            // TODO(i18n): wire up t()
            new Notice(`Open failed: ${e instanceof Error ? e.message : String(e)}`)
          );
        });
      }
    });
  }

  // 4. 重新索引相关 Notebook(仅当被引用时显示)
  if (referencingNotebooks.length > 0) {
    menu.addItem(item => {
      // TODO(i18n): wire up t()
      const label = referencingNotebooks.length === 1
        ? `Reindex "${referencingNotebooks[0].name}"`
        : `Reindex ${referencingNotebooks.length} related Notebooks`;
      item.setTitle(label).setIcon('refresh-cw')
        .onClick(() => {
          // fire-and-forget,与 main.ts triggerReindexAll 风格一致;失败时每个 notebook 各自报错
          for (const nb of referencingNotebooks) {
            deps.services.reindex(nb.id).catch(e =>
              // TODO(i18n): wire up t()
              new Notice(`Reindex of ${nb.name} failed: ${e instanceof Error ? e.message : String(e)}`)
            );
          }
          // TODO(i18n): wire up t()
          new Notice(`Reindex triggered for ${referencingNotebooks.length} Notebook(s) (running in background)`);
        });
    });
  }
}

async function addFolderAsSource(
  notebook: Notebook,
  folderPath: string,
  deps: FolderContextMenuDeps,
): Promise<void> {
  const newSources = [
    ...notebook.sources,
    // I2: spec §8.1 要求 enabled:true
    // updateNotebook 是 patch 风格,不会为新 source 补 UUID(只有 createNotebook 会),手动补
    { id: crypto.randomUUID(), type: 'folder' as const, path: folderPath, recursive: true, enabled: true },
  ];
  try {
    await deps.services.updateNotebook(notebook.id, { sources: newSources });
    // TODO(i18n): wire up t()
    new Notice(`Added ${folderPath} as a source of ${notebook.name}`);
  } catch (e) {
    // TODO(i18n): wire up t()
    new Notice(`Add failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
