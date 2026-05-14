import { describe, it, expect } from 'vitest';
import { SessionStore } from 'src/services/SessionStore';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import { makeFakeClock } from 'src/infra/clock';
import type { ChatTurn } from 'src/types/chat';

function makeStore(initialClockMs = 1000) {
  const dataStore = new InMemoryDataStoreAdapter();
  const paths = new StoragePaths('/p');
  const clock = makeFakeClock(initialClockMs);
  const store = new SessionStore({ dataStore, paths, clock });
  return { store, dataStore, paths, clock };
}

function makeTurn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: 'hello',
    createdAt: 1000,
    ...overrides,
  };
}

describe('SessionStore', () => {
  // ── Test 1 ────────────────────────────────────────────────────────────────
  it('create(): generates UUID, persists empty turns array to disk', async () => {
    const { store, dataStore, paths } = makeStore();
    const session = await store.create('nb-1');

    expect(session.id).toBeTruthy();
    expect(session.notebookId).toBe('nb-1');
    expect(session.turns).toEqual([]);
    expect(session.createdAt).toBe(1000);
    expect(session.updatedAt).toBe(1000);

    // file written on disk
    const raw = await dataStore.read(paths.sessionFile('nb-1', session.id));
    expect(raw).not.toBeNull();
    const onDisk = JSON.parse(raw as string);
    expect(onDisk.id).toBe(session.id);
    expect(onDisk.turns).toEqual([]);
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  it('load(): returns null when session does not exist', async () => {
    const { store } = makeStore();
    const result = await store.load('nb-1', 'no-such-session');
    expect(result).toBeNull();
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  it('save(): updatedAt is refreshed by clock on each save', async () => {
    const { store, clock } = makeStore(1000);
    const session = await store.create('nb-1');
    expect(session.updatedAt).toBe(1000);

    clock.set(5000);
    await store.save(session);

    const reloaded = await store.load('nb-1', session.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.updatedAt).toBe(5000);
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  it('appendTurn(): accumulates turns in order across multiple appends', async () => {
    const { store } = makeStore();
    const session = await store.create('nb-1');

    const t1 = makeTurn({ role: 'user', content: 'first' });
    const t2 = makeTurn({ role: 'assistant', content: 'second' });

    await store.appendTurn('nb-1', session.id, t1);
    const after2 = await store.appendTurn('nb-1', session.id, t2);

    expect(after2.turns).toHaveLength(2);
    expect(after2.turns[0].content).toBe('first');
    expect(after2.turns[1].content).toBe('second');

    const reloaded = await store.load('nb-1', session.id);
    expect(reloaded!.turns).toHaveLength(2);
    expect(reloaded!.turns.map(t => t.content)).toEqual(['first', 'second']);
  });

  // ── Test 5 ────────────────────────────────────────────────────────────────
  it('appendTurn(): throws when session not found', async () => {
    const { store } = makeStore();
    await expect(
      store.appendTurn('nb-1', 'missing-id', makeTurn()),
    ).rejects.toThrow(/session not found/);
  });

  // ── Test 6 ────────────────────────────────────────────────────────────────
  it('list(): returns all session ids under notebook (without .json suffix)', async () => {
    const { store } = makeStore();
    const s1 = await store.create('nb-1');
    const s2 = await store.create('nb-1');

    const ids = await store.list('nb-1');
    expect(ids).toHaveLength(2);
    expect(ids.sort()).toEqual([s1.id, s2.id].sort());
    // no .json suffix
    expect(ids.every(id => !id.endsWith('.json'))).toBe(true);
  });

  // ── Test 7 ────────────────────────────────────────────────────────────────
  it('list(): returns empty array when conversations dir does not exist', async () => {
    const { store } = makeStore();
    await expect(store.list('nb-empty')).resolves.toEqual([]);
  });

  // ── Test 8 ────────────────────────────────────────────────────────────────
  it('delete(): subsequent load returns null', async () => {
    const { store } = makeStore();
    const session = await store.create('nb-1');
    expect(await store.load('nb-1', session.id)).not.toBeNull();

    await store.delete('nb-1', session.id);

    expect(await store.load('nb-1', session.id)).toBeNull();
  });

  // ── Test 9 ────────────────────────────────────────────────────────────────
  it('delete(): does not throw when session was already absent', async () => {
    const { store } = makeStore();
    await expect(store.delete('nb-1', 'never-existed')).resolves.toBeUndefined();
  });
});
