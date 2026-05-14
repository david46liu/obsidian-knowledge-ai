import { describe, it, expect } from 'vitest';
import { ArtifactStore } from 'src/services/ArtifactStore';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import type { Artifact } from 'src/types/artifact';

function makeStore() {
  const dataStore = new InMemoryDataStoreAdapter();
  const paths = new StoragePaths('/p');
  const store = new ArtifactStore({ dataStore, paths });
  return { store, dataStore, paths };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: crypto.randomUUID(),
    notebookId: 'nb-1',
    kind: 'summary',
    title: 'Sample Title',
    content: 'Sample content body.',
    citations: [],
    modelUsed: 'test-model',
    generatedAt: 1000,
    ...overrides,
  };
}

describe('ArtifactStore', () => {
  // ── Test 1 ────────────────────────────────────────────────────────────────
  it('save() + load(): roundtrip preserves all fields', async () => {
    const { store } = makeStore();
    const artifact = makeArtifact({
      id: 'art-1',
      title: 'My Summary',
      content: 'Hello world',
      modelUsed: 'gpt-4o',
      generatedAt: 1234,
    });

    await store.save(artifact);
    const loaded = await store.load('nb-1', 'art-1');

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('art-1');
    expect(loaded!.notebookId).toBe('nb-1');
    expect(loaded!.kind).toBe('summary');
    expect(loaded!.title).toBe('My Summary');
    expect(loaded!.content).toBe('Hello world');
    expect(loaded!.citations).toEqual([]);
    expect(loaded!.modelUsed).toBe('gpt-4o');
    expect(loaded!.generatedAt).toBe(1234);
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  it('load(): returns null when artifact does not exist', async () => {
    const { store } = makeStore();
    const result = await store.load('nb-1', 'no-such-artifact');
    expect(result).toBeNull();
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  it('list(): returns empty array when artifacts dir does not exist', async () => {
    const { store } = makeStore();
    await expect(store.list('nb-empty')).resolves.toEqual([]);
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  it('list(): returns artifacts sorted by generatedAt DESC', async () => {
    const { store } = makeStore();
    const a1 = makeArtifact({ id: 'a1', generatedAt: 1000 });
    const a2 = makeArtifact({ id: 'a2', generatedAt: 3000 });
    const a3 = makeArtifact({ id: 'a3', generatedAt: 2000 });

    await store.save(a1);
    await store.save(a2);
    await store.save(a3);

    const list = await store.list('nb-1');
    expect(list).toHaveLength(3);
    expect(list.map(a => a.generatedAt)).toEqual([3000, 2000, 1000]);
    expect(list.map(a => a.id)).toEqual(['a2', 'a3', 'a1']);
  });

  // ── Test 5 ────────────────────────────────────────────────────────────────
  it('list(): filters out non-.json files', async () => {
    const { store, dataStore, paths } = makeStore();
    const a1 = makeArtifact({ id: 'a1', generatedAt: 1000 });
    await store.save(a1);

    // 手动写入一个 .txt 干扰文件
    await dataStore.writeAtomic(
      `${paths.artifactsDir('nb-1')}/garbage.txt`,
      'not json',
    );

    const list = await store.list('nb-1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a1');
  });

  // ── Test 6 ────────────────────────────────────────────────────────────────
  it('delete(): subsequent load returns null', async () => {
    const { store } = makeStore();
    const a = makeArtifact({ id: 'art-del' });
    await store.save(a);
    expect(await store.load('nb-1', 'art-del')).not.toBeNull();

    await store.delete('nb-1', 'art-del');

    expect(await store.load('nb-1', 'art-del')).toBeNull();
  });

  // ── Test 7 ────────────────────────────────────────────────────────────────
  it('delete(): does not throw when artifact was already absent', async () => {
    const { store } = makeStore();
    await expect(store.delete('nb-1', 'never-existed')).resolves.toBeUndefined();
  });

  // ── Test 8 ────────────────────────────────────────────────────────────────
  it('save(): auto-creates artifacts dir even when notebook subdir does not exist', async () => {
    const { store } = makeStore();
    const a = makeArtifact({ id: 'art-fresh', notebookId: 'nb-fresh' });

    // notebook 目录从未创建过(没有 conversations/artifacts 子目录)
    await expect(store.save(a)).resolves.toBeUndefined();

    const loaded = await store.load('nb-fresh', 'art-fresh');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('art-fresh');
  });
});
