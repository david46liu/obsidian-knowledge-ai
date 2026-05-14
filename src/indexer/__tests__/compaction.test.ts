import { describe, it, expect } from 'vitest';
import { runCompaction, recoverFromLock } from 'src/indexer/compaction';
import { HashCacheStore } from 'src/indexer/hashCache';
import { PathMapStore } from 'src/indexer/pathMap';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';

describe('runCompaction', () => {
  it('collapses append-only log into latest-only entries', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();

    await hc.append({ fileHash: 'h1', fileSize: 1, chunks: [], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });
    await hc.append({ fileHash: 'h1', fileSize: 1, chunks: [], chunkingVersion: 1, parserVersion: 1, indexedAt: 2, status: 'ok' });
    await hc.append({ fileHash: 'h2', fileSize: 1, chunks: [], chunkingVersion: 1, parserVersion: 1, indexedAt: 3, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'h1', sourceMtime: 1, observedAt: 1 });
    await pm.append({ filePath: 'a.md', fileHash: 'h1', sourceMtime: 2, observedAt: 2 });

    const rawBefore = await adapter.read(paths.hashesJsonl);
    expect(rawBefore!.split('\n').filter(Boolean)).toHaveLength(3);

    await runCompaction(adapter, paths, hc, pm);

    const rawAfter = await adapter.read(paths.hashesJsonl);
    expect(rawAfter!.split('\n').filter(Boolean)).toHaveLength(2);
    expect(hc.get('h1')?.indexedAt).toBe(2);
    expect(pm.get('a.md')?.sourceMtime).toBe(2);
  });

  it('removes lock file on success', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    await hc.append({ fileHash: 'h1', fileSize: 1, chunks: [], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });

    await runCompaction(adapter, paths, hc, pm);
    expect(await adapter.exists(paths.compactLock)).toBe(false);
  });

  it('lock is preserved when phase 2 throws', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    await hc.append({ fileHash: 'h1', fileSize: 1, chunks: [], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });
    await pm.append({ filePath: 'a.md', fileHash: 'h1', sourceMtime: 1, observedAt: 1 });

    let renameCalls = 0;
    const origRename = adapter.rename.bind(adapter);
    adapter.rename = async (src: string, dst: string) => {
      renameCalls++;
      if (renameCalls === 2) throw new Error('simulated phase-2 crash');
      return origRename(src, dst);
    };

    await expect(runCompaction(adapter, paths, hc, pm)).rejects.toThrow('simulated phase-2 crash');
    expect(await adapter.exists(paths.compactLock)).toBe(true);
  });

  it('filters out tombstoned entries from compacted output', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    const pm = new PathMapStore(adapter, paths);
    await hc.load(); await pm.load();
    await hc.append({ fileHash: 'h1', fileSize: 1, chunks: [], chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok' });
    await hc.append({ fileHash: 'h1', fileSize: 1, chunks: [], chunkingVersion: 1, parserVersion: 1, indexedAt: 2, status: 'ok', tombstone: true });

    await runCompaction(adapter, paths, hc, pm);

    const rawAfter = await adapter.read(paths.hashesJsonl);
    expect(rawAfter!.split('\n').filter(Boolean)).toHaveLength(0);
  });
});

describe('recoverFromLock — 4 crash branches', () => {
  it('(✓,✓) Phase 1 完成、Phase 2 中断 → 补完两个 rename', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    await adapter.writeAtomic(paths.compactLock, 'stale');
    await adapter.writeAtomic(paths.hashesJsonl + '.tmp', 'NEW_HASHES\n');
    await adapter.writeAtomic(paths.pathsJsonl + '.tmp', 'NEW_PATHS\n');
    await adapter.writeAtomic(paths.hashesJsonl, 'OLD_HASHES\n');
    await adapter.writeAtomic(paths.pathsJsonl, 'OLD_PATHS\n');

    await recoverFromLock(adapter, paths);

    expect(await adapter.exists(paths.compactLock)).toBe(false);
    expect(await adapter.exists(paths.hashesJsonl + '.tmp')).toBe(false);
    expect(await adapter.exists(paths.pathsJsonl + '.tmp')).toBe(false);
    expect(await adapter.read(paths.hashesJsonl)).toBe('NEW_HASHES\n');
    expect(await adapter.read(paths.pathsJsonl)).toBe('NEW_PATHS\n');
  });

  it('(✓,✗) Phase 1 部分完成 → 删 hashes.tmp,不动 paths.jsonl', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    await adapter.writeAtomic(paths.compactLock, 'stale');
    await adapter.writeAtomic(paths.hashesJsonl + '.tmp', 'HALF_NEW\n');
    await adapter.writeAtomic(paths.hashesJsonl, 'OLD_HASHES\n');
    await adapter.writeAtomic(paths.pathsJsonl, 'OLD_PATHS\n');

    await recoverFromLock(adapter, paths);

    expect(await adapter.exists(paths.hashesJsonl + '.tmp')).toBe(false);
    expect(await adapter.read(paths.hashesJsonl)).toBe('OLD_HASHES\n');
    expect(await adapter.read(paths.pathsJsonl)).toBe('OLD_PATHS\n');
    expect(await adapter.exists(paths.compactLock)).toBe(false);
  });

  it('(✗,✓) Phase 2 中途(hashes 已 rename,paths 还是 tmp) → 补完 paths.tmp rename', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    await adapter.writeAtomic(paths.compactLock, 'stale');
    await adapter.writeAtomic(paths.hashesJsonl, 'NEW_HASHES\n');
    await adapter.writeAtomic(paths.pathsJsonl + '.tmp', 'NEW_PATHS\n');
    await adapter.writeAtomic(paths.pathsJsonl, 'OLD_PATHS\n');

    await recoverFromLock(adapter, paths);

    expect(await adapter.exists(paths.pathsJsonl + '.tmp')).toBe(false);
    expect(await adapter.read(paths.hashesJsonl)).toBe('NEW_HASHES\n');
    expect(await adapter.read(paths.pathsJsonl)).toBe('NEW_PATHS\n');
  });

  it('(✗,✗) 无 tmp → 只删 lock', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    await adapter.writeAtomic(paths.compactLock, 'stale');
    await adapter.writeAtomic(paths.hashesJsonl, 'OLD\n');

    await recoverFromLock(adapter, paths);

    expect(await adapter.exists(paths.compactLock)).toBe(false);
    expect(await adapter.read(paths.hashesJsonl)).toBe('OLD\n');
  });

  it('no lock → no-op', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    await expect(recoverFromLock(adapter, paths)).resolves.toBeUndefined();
  });
});
