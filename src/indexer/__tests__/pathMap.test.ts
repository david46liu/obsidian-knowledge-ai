import { describe, it, expect } from 'vitest';
import { PathMapStore } from 'src/indexer/pathMap';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import type { PathMapEntry } from 'src/types/data';

function mk(path: string, hash: string, over: Partial<PathMapEntry> = {}): PathMapEntry {
  return {
    filePath: path,
    fileHash: hash,
    sourceMtime: 100,
    observedAt: 100,
    ...over,
  };
}

describe('PathMapStore', () => {
  it('append & get latest by path', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new PathMapStore(adapter, paths);
    await store.load();
    await store.append(mk('a.md', 'h1'));
    await store.append(mk('a.md', 'h2'));
    expect(store.get('a.md')?.fileHash).toBe('h2');
  });

  it('tombstone hides path from get()', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new PathMapStore(adapter, paths);
    await store.load();
    await store.append(mk('a.md', 'h1'));
    await store.append(mk('a.md', 'h1', { tombstone: true }));
    expect(store.get('a.md')).toBeUndefined();
  });

  it('alivePathsFor returns all paths currently pointing at a hash', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new PathMapStore(adapter, paths);
    await store.load();
    await store.append(mk('a.md', 'h1'));
    await store.append(mk('b.md', 'h1'));
    await store.append(mk('c.md', 'h2'));
    expect(new Set(store.alivePathsFor('h1'))).toEqual(new Set(['a.md', 'b.md']));
    expect(store.alivePathsFor('h2')).toEqual(['c.md']);
  });

  it('alivePathsFor excludes tombstoned paths', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new PathMapStore(adapter, paths);
    await store.load();
    await store.append(mk('a.md', 'h1'));
    await store.append(mk('b.md', 'h1'));
    await store.append(mk('a.md', 'h1', { tombstone: true }));
    expect(store.alivePathsFor('h1')).toEqual(['b.md']);
  });

  it('revive after tombstone', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new PathMapStore(adapter, paths);
    await store.load();
    await store.append(mk('a.md', 'h1'));
    await store.append(mk('a.md', 'h1', { tombstone: true }));
    await store.append(mk('a.md', 'h2', { observedAt: 500 }));
    expect(store.get('a.md')?.fileHash).toBe('h2');
    expect(store.alivePathsFor('h2')).toEqual(['a.md']);
  });

  it('allAlivePaths iterates everything not tombstoned', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new PathMapStore(adapter, paths);
    await store.load();
    await store.append(mk('a.md', 'h1'));
    await store.append(mk('b.md', 'h2'));
    await store.append(mk('c.md', 'h3', { tombstone: true }));
    expect(new Set(store.allAlivePaths())).toEqual(new Set(['a.md', 'b.md']));
  });
});
