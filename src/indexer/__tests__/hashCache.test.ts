import { describe, it, expect } from 'vitest';
import { HashCacheStore } from 'src/indexer/hashCache';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import type { HashCacheEntry } from 'src/types/data';

function makeEntry(hash: string, over: Partial<HashCacheEntry> = {}): HashCacheEntry {
  return {
    fileHash: hash,
    fileSize: 10,
    chunks: [],
    chunkingVersion: 1,
    parserVersion: 1,
    indexedAt: 100,
    status: 'ok',
    ...over,
  };
}

describe('HashCacheStore', () => {
  it('load from empty store → empty map', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new HashCacheStore(adapter, paths);
    await store.load();
    expect(store.get('abc')).toBeUndefined();
  });

  it('append writes a JSONL line and updates in-memory map', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new HashCacheStore(adapter, paths);
    await store.load();
    await store.append(makeEntry('aaa'));
    expect(store.get('aaa')?.fileHash).toBe('aaa');

    const raw = await adapter.read(paths.hashesJsonl);
    expect(raw).toContain('"fileHash":"aaa"');
  });

  it('later entry overrides earlier for same hash', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new HashCacheStore(adapter, paths);
    await store.load();
    await store.append(makeEntry('aaa', { indexedAt: 100 }));
    await store.append(makeEntry('aaa', { indexedAt: 200 }));
    expect(store.get('aaa')?.indexedAt).toBe(200);
  });

  it('tombstone marks entry as deleted (get returns undefined for tombstoned)', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new HashCacheStore(adapter, paths);
    await store.load();
    await store.append(makeEntry('aaa'));
    await store.append(makeEntry('aaa', { tombstone: true }));
    expect(store.get('aaa')).toBeUndefined();
    expect(store.getRaw('aaa')?.tombstone).toBe(true);
  });

  it('revives after tombstone when a new non-tombstone entry is appended', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const store = new HashCacheStore(adapter, paths);
    await store.load();
    await store.append(makeEntry('aaa'));
    await store.append(makeEntry('aaa', { tombstone: true }));
    await store.append(makeEntry('aaa', { indexedAt: 300 }));
    expect(store.get('aaa')?.indexedAt).toBe(300);
  });

  it('load parses existing JSONL on startup', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    await adapter.writeAtomic(
      paths.hashesJsonl,
      JSON.stringify(makeEntry('aaa')) + '\n' +
      JSON.stringify(makeEntry('aaa', { indexedAt: 500 })) + '\n' +
      JSON.stringify(makeEntry('bbb')) + '\n'
    );
    const store = new HashCacheStore(adapter, paths);
    await store.load();
    expect(store.get('aaa')?.indexedAt).toBe(500);
    expect(store.get('bbb')?.fileHash).toBe('bbb');
  });
});
