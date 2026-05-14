import { describe, it, expect } from 'vitest';
import { BM25Store } from 'src/retrieval/bm25';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import type { Chunk } from 'src/types/data';

function mkChunk(id: string, content: string, heading = ''): Chunk {
  return {
    id, chunkIndex: Number(id.split(':')[1] ?? 0),
    fileHash: id.split(':')[0], filePath: 'a.md', sourceId: 's',
    headingText: heading, headingPath: heading ? heading.split(' > ') : [],
    content, contentHash: 'h', tokenCount: content.length,
    charStart: 0, charEnd: content.length, kind: 'paragraph',
  };
}

describe('BM25Store', () => {
  it('add + search finds by content tokens', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const store = new BM25Store(adapter, paths, 'nb1', 1);
    store.add([mkChunk('hA:0', '这是关于机器学习的笔记')]);
    const hits = store.search('机器学习');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe('hA:0');
  });

  it('search boosts headingText hits', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const store = new BM25Store(adapter, paths, 'nb1', 1);
    store.add([
      mkChunk('h1:0', '一些无关内容', '机器学习'),
      mkChunk('h2:0', '机器学习相关段落'),
    ]);
    const hits = store.search('机器学习');
    expect(hits[0].id).toBe('h1:0');
  });

  it('discardByIds removes chunks from index', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const store = new BM25Store(adapter, paths, 'nb1', 1);
    store.add([mkChunk('hA:0', '唯一的内容')]);
    store.discardByIds(['hA:0']);
    expect(store.search('唯一')).toEqual([]);
  });

  it('persist + load roundtrip', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const store = new BM25Store(adapter, paths, 'nb1', 1);
    store.add([mkChunk('hA:0', '机器学习内容')]);
    await store.persist();

    const restored = new BM25Store(adapter, paths, 'nb1', 1);
    const loaded = await restored.load();
    expect(loaded).toBe(true);
    expect(restored.search('机器学习').map(h => h.id)).toContain('hA:0');
  });

  it('load returns false when chunkingVersion mismatches', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const a = new BM25Store(adapter, paths, 'nb1', 1);
    a.add([mkChunk('hA:0', 'x')]);
    await a.persist();

    const b = new BM25Store(adapter, paths, 'nb1', 2);
    const loaded = await b.load();
    expect(loaded).toBe(false);
  });

  it('load returns false when file missing', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const b = new BM25Store(adapter, paths, 'nb1', 1);
    expect(await b.load()).toBe(false);
  });
});
