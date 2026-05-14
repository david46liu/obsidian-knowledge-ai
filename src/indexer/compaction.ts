import type { IDataStoreAdapter } from 'src/adapters/types';
import type { StoragePaths } from 'src/storage/paths';
import type { HashCacheStore } from 'src/indexer/hashCache';
import type { PathMapStore } from 'src/indexer/pathMap';

/**
 * 物理压实 hashes.jsonl + paths.jsonl(spec §3.1.6),两阶段 tmp 协议。
 * Phase 0: 写 .compact.lock
 * Phase 1: writeAtomic 写 hashes.jsonl.tmp 和 paths.jsonl.tmp
 * Phase 2: rename hashes.jsonl.tmp → hashes.jsonl,再 rename paths.jsonl.tmp → paths.jsonl
 * Phase 3: 删 lock(仅所有阶段成功才清;中途失败保留 lock 让 recoverFromLock 下次修复)
 */
export async function runCompaction(
  adapter: IDataStoreAdapter,
  paths: StoragePaths,
  hashCache: HashCacheStore,
  pathMap: PathMapStore
): Promise<void> {
  const hashTmp = paths.hashesJsonl + '.tmp';
  const pathTmp = paths.pathsJsonl + '.tmp';

  await adapter.writeAtomic(paths.compactLock, String(Date.now()));

  const hashLines = [...hashCache.aliveEntries()].map(e => JSON.stringify(e)).join('\n');
  const pathLines = [...pathMap.allAliveEntries()].map(e => JSON.stringify(e)).join('\n');
  const hashContent = hashLines.length > 0 ? hashLines + '\n' : '';
  const pathContent = pathLines.length > 0 ? pathLines + '\n' : '';

  // Phase 1: 先写两个 tmp,都成功才进入 rename
  await adapter.writeAtomic(hashTmp, hashContent);
  await adapter.writeAtomic(pathTmp, pathContent);

  // Phase 2: 依序 rename
  await adapter.rename(hashTmp, paths.hashesJsonl);
  await adapter.rename(pathTmp, paths.pathsJsonl);

  await hashCache.load();
  await pathMap.load();

  await adapter.remove(paths.compactLock);
}

/**
 * 启动时调用。按 tmp 存在性 4 分支恢复:
 *   (✓, ✓) → Phase 1 完成,Phase 2 中断 → 补完两个 rename
 *   (✓, ✗) → Phase 1 中途崩 → 删 hashes.tmp
 *   (✗, ✓) → Phase 2 中途崩 → 补完 paths.tmp rename
 *   (✗, ✗) → 无 tmp 残留 → 无动作
 * 最后统一删 lock。
 */
export async function recoverFromLock(
  adapter: IDataStoreAdapter,
  paths: StoragePaths
): Promise<void> {
  if (!(await adapter.exists(paths.compactLock))) return;
  const hashTmp = paths.hashesJsonl + '.tmp';
  const pathTmp = paths.pathsJsonl + '.tmp';
  const hashTmpExists = await adapter.exists(hashTmp);
  const pathTmpExists = await adapter.exists(pathTmp);

  if (hashTmpExists && pathTmpExists) {
    await adapter.rename(hashTmp, paths.hashesJsonl);
    await adapter.rename(pathTmp, paths.pathsJsonl);
  } else if (hashTmpExists && !pathTmpExists) {
    await adapter.remove(hashTmp);
  } else if (!hashTmpExists && pathTmpExists) {
    await adapter.rename(pathTmp, paths.pathsJsonl);
  }

  await adapter.remove(paths.compactLock);
}
