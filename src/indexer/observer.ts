import type { IVaultAdapter, VaultEventPayload } from 'src/adapters/types';
import type { Notebook } from 'src/types/data';
import { matchesNotebookScope } from 'src/indexer/scope';

export type ObserverNotebookShape = Pick<Notebook, 'id' | 'sources'>;

export interface ObserverDeps {
  vault: IVaultAdapter;
  notebooks: () => ObserverNotebookShape[];
  debounceMs: number;
  onDirty: (payload: { notebookIds: string[]; paths: string[] }) => void;
}

/** vault 事件 → 按 path 维度 debounce → onDirty。不触碰索引状态。
 *
 * 语义: 每次事件都把 path 加入 pending 集合, 并重置一个共享 debounce timer;
 * timer 触发时一次性把所有 pending path 结合 notebooks 作用域做 dirty 派发。
 * 多个路径的 rename/批量写入会被合并到同一次 onDirty 调用中。
 */
export function createVaultObserver(deps: ObserverDeps): () => void {
  const pendingPaths = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (pendingPaths.size === 0) return;
    const paths = [...pendingPaths];
    pendingPaths.clear();

    const notebooks = deps.notebooks();
    const affected = new Set<string>();
    const filteredPaths: string[] = [];
    for (const p of paths) {
      for (const nb of notebooks) {
        if (matchesNotebookScope(p, nb)) {
          affected.add(nb.id);
          if (!filteredPaths.includes(p)) filteredPaths.push(p);
        }
      }
    }
    if (affected.size > 0) {
      deps.onDirty({ notebookIds: [...affected], paths: filteredPaths });
    }
  };

  const noteEvent = (p: string) => {
    pendingPaths.add(p);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, deps.debounceMs);
  };

  const handler = (payload: VaultEventPayload) => {
    switch (payload.type) {
      case 'modify':
      case 'create':
      case 'delete':
        noteEvent(payload.path);
        break;
      case 'rename':
        noteEvent(payload.oldPath);
        noteEvent(payload.path);
        break;
    }
  };

  const off = deps.vault.on(handler);
  return () => {
    off();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pendingPaths.clear();
  };
}
