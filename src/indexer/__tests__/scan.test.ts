import { describe, it, expect } from 'vitest';
import { scanDiff } from 'src/indexer/scan';
import { PathMapStore } from 'src/indexer/pathMap';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';

async function mkPathMap(entries: Array<{ path: string; hash: string; mtime?: number }>) {
  const adapter = new InMemoryDataStoreAdapter();
  const paths = new StoragePaths('/p');
  const store = new PathMapStore(adapter, paths);
  await store.load();
  for (const e of entries) {
    await store.append({
      filePath: e.path,
      fileHash: e.hash,
      sourceMtime: e.mtime ?? 100,
      observedAt: 100,
    });
  }
  return store;
}

const hashMap: Record<string, string> = {
  'A': 'hA', 'B': 'hB', 'C': 'hC', 'A2': 'hA2',
};
const fakeHash = async (bytes: Uint8Array) => {
  const c = new TextDecoder().decode(bytes);
  return hashMap[c] ?? 'h' + c;
};
const anyScope = (_: string) => true;

describe('scanDiff', () => {
  it('UNCHANGED: same path + same sourceMtime → no work', async () => {
    const pathMap = await mkPathMap([{ path: 'a.md', hash: 'hA', mtime: 100 }]);
    const res = await scanDiff(
      [{ path: 'a.md', sourceMtime: 100, fileSize: 1, contentBytes: new TextEncoder().encode('A') }],
      pathMap, anyScope, fakeHash
    );
    expect(res.entries.find(e => e.filePath === 'a.md')?.classification).toBe('UNCHANGED');
  });

  it('MTIME_ONLY: mtime changed but hash unchanged', async () => {
    const pathMap = await mkPathMap([{ path: 'a.md', hash: 'hA', mtime: 100 }]);
    const res = await scanDiff(
      [{ path: 'a.md', sourceMtime: 200, fileSize: 1, contentBytes: new TextEncoder().encode('A') }],
      pathMap, anyScope, fakeHash
    );
    const e = res.entries.find(e => e.filePath === 'a.md')!;
    expect(e.classification).toBe('MTIME_ONLY');
    expect(e.oldHash).toBe('hA');
  });

  it('CONTENT_CHANGED: mtime changed and hash changed', async () => {
    const pathMap = await mkPathMap([{ path: 'a.md', hash: 'hA', mtime: 100 }]);
    const res = await scanDiff(
      [{ path: 'a.md', sourceMtime: 200, fileSize: 1, contentBytes: new TextEncoder().encode('A2') }],
      pathMap, anyScope, fakeHash
    );
    const e = res.entries.find(e => e.filePath === 'a.md')!;
    expect(e.classification).toBe('CONTENT_CHANGED');
    expect(e.oldHash).toBe('hA');
    expect(e.newHash).toBe('hA2');
  });

  it('NEW_PATH: path not in PathMap', async () => {
    const pathMap = await mkPathMap([]);
    const res = await scanDiff(
      [{ path: 'new.md', sourceMtime: 200, fileSize: 1, contentBytes: new TextEncoder().encode('A') }],
      pathMap, anyScope, fakeHash
    );
    const e = res.entries.find(e => e.filePath === 'new.md')!;
    expect(e.classification).toBe('NEW_PATH');
    expect(e.newHash).toBe('hA');
  });

  it('DELETED: PathMap has path but scan does not', async () => {
    const pathMap = await mkPathMap([{ path: 'a.md', hash: 'hA', mtime: 100 }]);
    const res = await scanDiff([], pathMap, anyScope, fakeHash);
    const e = res.entries.find(e => e.filePath === 'a.md')!;
    expect(e.classification).toBe('DELETED');
    expect(e.oldHash).toBe('hA');
  });

  it('RENAMED: outgoing + incoming with same hash', async () => {
    const pathMap = await mkPathMap([{ path: 'old.md', hash: 'hA', mtime: 100 }]);
    const res = await scanDiff(
      [{ path: 'new.md', sourceMtime: 200, fileSize: 1, contentBytes: new TextEncoder().encode('A') }],
      pathMap, anyScope, fakeHash
    );
    const renamed = res.entries.find(e => e.classification === 'RENAMED');
    expect(renamed).toBeDefined();
    expect(renamed!.oldPath).toBe('old.md');
    expect(renamed!.newPath).toBe('new.md');
  });

  it('rename pairing is dictionary-order greedy', async () => {
    const pathMap = await mkPathMap([
      { path: 'x-old.md', hash: 'hA', mtime: 100 },
      { path: 'y-old.md', hash: 'hA', mtime: 100 },
    ]);
    const res = await scanDiff(
      [
        { path: 'a-new.md', sourceMtime: 200, fileSize: 1, contentBytes: new TextEncoder().encode('A') },
        { path: 'b-new.md', sourceMtime: 200, fileSize: 1, contentBytes: new TextEncoder().encode('A') },
      ],
      pathMap, anyScope, fakeHash
    );
    const renamed = res.entries.filter(e => e.classification === 'RENAMED');
    expect(renamed).toHaveLength(2);
    expect(renamed.find(r => r.oldPath === 'x-old.md')!.newPath).toBe('a-new.md');
    expect(renamed.find(r => r.oldPath === 'y-old.md')!.newPath).toBe('b-new.md');
  });

  it('content change + path change → DELETED + NEW_PATH (no fuzzy rename)', async () => {
    const pathMap = await mkPathMap([{ path: 'old.md', hash: 'hA', mtime: 100 }]);
    const res = await scanDiff(
      [{ path: 'new.md', sourceMtime: 200, fileSize: 1, contentBytes: new TextEncoder().encode('A2') }],
      pathMap, anyScope, fakeHash
    );
    const cls = res.entries.map(e => e.classification).sort();
    expect(cls).toEqual(['DELETED', 'NEW_PATH']);
  });

  it('**scope filter**: paths outside scope are NOT in P, so absent scan files do not become DELETED', async () => {
    const pathMap = await mkPathMap([
      { path: 'notes/a.md', hash: 'hA', mtime: 100 },
      { path: 'other/out.md', hash: 'hO', mtime: 100 },
    ]);
    const inScope = (p: string) => p.startsWith('notes/');
    const res = await scanDiff(
      [{ path: 'notes/a.md', sourceMtime: 100, fileSize: 1, contentBytes: new TextEncoder().encode('A') }],
      pathMap, inScope, fakeHash
    );
    expect(res.entries.find(e => e.filePath === 'notes/a.md')?.classification).toBe('UNCHANGED');
    expect(res.entries.find(e => e.filePath === 'other/out.md')).toBeUndefined();
  });

  it('**huge file → DELETED**: paths removed from S get tombstoned', async () => {
    const pathMap = await mkPathMap([
      { path: 'notes/small.md', hash: 'hS', mtime: 100 },
      { path: 'notes/huge.md', hash: 'hH', mtime: 100 },
    ]);
    const res = await scanDiff(
      [{ path: 'notes/small.md', sourceMtime: 100, fileSize: 1, contentBytes: new TextEncoder().encode('A') }],
      pathMap, anyScope, fakeHash
    );
    expect(res.entries.find(e => e.filePath === 'notes/small.md')?.classification).toBe('UNCHANGED');
    expect(res.entries.find(e => e.filePath === 'notes/huge.md')?.classification).toBe('DELETED');
  });

  it('**M1 size guard**: mtime same but size differs → CONTENT_CHANGED', async () => {
    const pathMap = await mkPathMap([{ path: 'a.md', hash: 'hA', mtime: 100 }]);
    const res = await scanDiff(
      [{ path: 'a.md', sourceMtime: 100, fileSize: 2, contentBytes: new TextEncoder().encode('A2') }],
      pathMap, anyScope, fakeHash,
      { fileSizeByHash: (h) => (h === 'hA' ? 1 : undefined) }
    );
    const e = res.entries.find(e => e.filePath === 'a.md')!;
    expect(e.classification).toBe('CONTENT_CHANGED');
    expect(e.oldHash).toBe('hA');
    expect(e.newHash).toBe('hA2');
  });

  it('M1 size guard: mtime same AND size same → UNCHANGED', async () => {
    const pathMap = await mkPathMap([{ path: 'a.md', hash: 'hA', mtime: 100 }]);
    const res = await scanDiff(
      [{ path: 'a.md', sourceMtime: 100, fileSize: 1, contentBytes: new TextEncoder().encode('A') }],
      pathMap, anyScope, fakeHash,
      { fileSizeByHash: (h) => (h === 'hA' ? 1 : undefined) }
    );
    expect(res.entries.find(e => e.filePath === 'a.md')?.classification).toBe('UNCHANGED');
  });

  it('upgrades UNCHANGED to STALE_PARSER when isFileCacheCurrent returns false', async () => {
    const pm = await mkPathMap([{ path: 'a.md', hash: 'hA', mtime: 1 }]);

    const scanned = [
      { path: 'a.md', sourceMtime: 1, fileSize: 5, contentBytes: new TextEncoder().encode('hello') },
    ];

    const result = await scanDiff(
      scanned, pm, () => true, fakeHash,
      {
        fileSizeByHash: () => 5,
        isFileCacheCurrent: (_path, hash) => hash !== 'hA',  // hA 视为过时
      }
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].classification).toBe('STALE_PARSER');
    expect(result.entries[0].filePath).toBe('a.md');
    expect(result.entries[0].oldHash).toBe('hA');
  });

  it('keeps UNCHANGED when isFileCacheCurrent returns true', async () => {
    const pm = await mkPathMap([{ path: 'a.md', hash: 'hA', mtime: 1 }]);

    const scanned = [
      { path: 'a.md', sourceMtime: 1, fileSize: 5, contentBytes: new TextEncoder().encode('hello') },
    ];

    const result = await scanDiff(
      scanned, pm, () => true, fakeHash,
      {
        fileSizeByHash: () => 5,
        isFileCacheCurrent: () => true,
      }
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].classification).toBe('UNCHANGED');
  });
});
