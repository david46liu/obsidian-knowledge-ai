import { describe, it, expect, vi } from 'vitest';
import { NotebookService } from 'src/services/NotebookService';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import { makeFakeClock } from 'src/infra/clock';
import type { Source, TaskAssignment } from 'src/types/data';

/** Read a file through the adapter and parse as JSON (resolves path normalisation). */
async function readDiskJson<T>(adapter: InMemoryDataStoreAdapter, filePath: string): Promise<T> {
  const raw = await adapter.read(filePath);
  if (raw == null) throw new Error(`file not found on disk: ${filePath}`);
  return JSON.parse(raw) as T;
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src-1',
    type: 'folder',
    path: 'notes',
    recursive: true,
    ...overrides,
  };
}

function makeService(adapter?: InMemoryDataStoreAdapter, clockMs = 1000) {
  const dataStore = adapter ?? new InMemoryDataStoreAdapter();
  const paths = new StoragePaths('/plugin');
  const clock = makeFakeClock(clockMs);
  const svc = new NotebookService({ dataStore, paths, clock });
  return { svc, dataStore, paths, clock };
}

// ── Test 1: loadAll() — data.json absent, notebooks/ empty ────────────────
describe('NotebookService', () => {
  it('loadAll(): no data.json, empty notebooks/ → defaults + empty list', async () => {
    const { svc } = makeService();
    await svc.loadAll();

    const data = svc.getPluginData();
    expect(data.schemaVersion).toBe(1);
    expect(data.providers).toEqual([]);
    expect(data.taskAssignments).toEqual({});
    expect(svc.listNotebooks()).toEqual([]);
  });

  // ── Test 2: loadAll() — data.json present + 2 notebook files ─────────────
  it('loadAll(): data.json + 2 notebooks → all loaded correctly', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');

    const pluginData = {
      schemaVersion: 1 as const,
      providers: [],
      taskAssignments: {},
    };
    await adapter.writeAtomic(paths.pluginDataFile, JSON.stringify(pluginData));

    const nb1 = {
      id: 'nb-aaa',
      name: 'Alpha',
      sources: [makeSource({ id: 's1' })],
      status: 'idle' as const,
      createdAt: 100,
      updatedAt: 100,
    };
    const nb2 = {
      id: 'nb-bbb',
      name: 'Beta',
      sources: [makeSource({ id: 's2' })],
      status: 'idle' as const,
      createdAt: 200,
      updatedAt: 200,
    };
    await adapter.writeAtomic(paths.notebookFile('nb-aaa'), JSON.stringify(nb1));
    await adapter.writeAtomic(paths.notebookFile('nb-bbb'), JSON.stringify(nb2));

    const clock = makeFakeClock(1000);
    const svc = new NotebookService({ dataStore: adapter, paths, clock });
    await svc.loadAll();

    const notebooks = svc.listNotebooks();
    expect(notebooks).toHaveLength(2);
    const ids = notebooks.map(n => n.id).sort();
    expect(ids).toEqual(['nb-aaa', 'nb-bbb']);
    expect(await svc.getNotebook('nb-aaa')).toMatchObject({ name: 'Alpha' });
    expect(await svc.getNotebook('nb-bbb')).toMatchObject({ name: 'Beta' });
  });

  // ── Test 3: createNotebook() ───────────────────────────────────────────────
  it('createNotebook(): writes file, updates in-memory map, returns correct notebook', async () => {
    const { svc, dataStore, paths } = makeService();
    await svc.loadAll();

    const source = makeSource();
    const nb = await svc.createNotebook('My Notebook', source);

    // returned notebook fields
    expect(nb.name).toBe('My Notebook');
    expect(nb.status).toBe('idle');
    expect(nb.createdAt).toBe(1000);
    expect(nb.updatedAt).toBe(1000);
    expect(nb.id).toBeTruthy();
    expect(nb.sources).toHaveLength(1);
    expect(nb.sources[0].type).toBe('folder');
    expect(nb.sources[0].path).toBe('notes');
    expect(nb.sources[0].id).not.toBe('src-1');  // impl re-generates source id

    // in-memory map updated
    expect(await svc.getNotebook(nb.id)).toMatchObject({ name: 'My Notebook' });
    expect(svc.listNotebooks()).toHaveLength(1);

    // file written to disk
    expect(await dataStore.exists(paths.notebookFile(nb.id))).toBe(true);
    const diskNb = await readDiskJson<{ name: string; id: string }>(dataStore, paths.notebookFile(nb.id));
    expect(diskNb.name).toBe('My Notebook');
    expect(diskNb.id).toBe(nb.id);
  });

  // ── Test 4: updateNotebook() ───────────────────────────────────────────────
  it('updateNotebook(): updatedAt changes, disk file updated', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const clock = makeFakeClock(1000);
    const svc = new NotebookService({ dataStore: adapter, paths, clock });
    await svc.loadAll();

    const nb = await svc.createNotebook('Original', makeSource());
    const originalUpdatedAt = nb.updatedAt;

    // advance clock
    clock.set(2000);

    const updated = await svc.updateNotebook(nb.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.updatedAt).toBe(2000);
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);

    // disk updated
    const diskNb = await readDiskJson<{ name: string; updatedAt: number }>(adapter, paths.notebookFile(nb.id));
    expect(diskNb.name).toBe('Renamed');
    expect(diskNb.updatedAt).toBe(2000);
  });

  // ── Test 5: deleteNotebook() ───────────────────────────────────────────────
  it('deleteNotebook(): clears in-memory map and removes disk file', async () => {
    const { svc, dataStore, paths } = makeService();
    await svc.loadAll();

    const nb = await svc.createNotebook('To Delete', makeSource());
    expect(svc.listNotebooks()).toHaveLength(1);
    expect(await dataStore.exists(paths.notebookFile(nb.id))).toBe(true);

    await svc.deleteNotebook(nb.id);

    expect(svc.listNotebooks()).toHaveLength(0);
    expect(await svc.getNotebook(nb.id)).toBeNull();
    expect(await dataStore.exists(paths.notebookFile(nb.id))).toBe(false);

    // should not throw even if already deleted
    await expect(svc.deleteNotebook(nb.id)).resolves.toBeUndefined();
  });

  // ── Test 6: persistState() ────────────────────────────────────────────────
  it('persistState(): patch merges correctly into memory + disk', async () => {
    const { svc, dataStore, paths } = makeService();
    await svc.loadAll();

    const nb = await svc.createNotebook('Indexable', makeSource());

    await svc.persistState(nb.id, { status: 'indexing' });

    const inMemory = await svc.getNotebook(nb.id);
    expect(inMemory?.status).toBe('indexing');
    expect(inMemory?.name).toBe('Indexable'); // other fields preserved
    expect(inMemory?.updatedAt).toBe(1000); // clock value used by makeService()

    const diskNb = await readDiskJson<{ status: string }>(dataStore, paths.notebookFile(nb.id));
    expect(diskNb.status).toBe('indexing');

    // persistState on unknown id should silently skip
    await expect(svc.persistState('nonexistent-id', { status: 'idle' })).resolves.toBeUndefined();
  });

  // ── Test 7: addProvider() ─────────────────────────────────────────────────
  it('addProvider(): adds to providers array and persists to data.json', async () => {
    const { svc, dataStore, paths } = makeService();
    await svc.loadAll();

    const draft = {
      displayName: 'OpenAI',
      kind: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      defaultModel: 'gpt-4o',
      timeoutMs: 30000,
      capabilities: {
        supportsJsonMode: true,
        supportsStreaming: true,
        supportsTools: true,
        supportsTemperature: true,
        supportsMaxTokens: true,
        maxTokensFieldName: 'max_tokens' as const,
        supportsEmbeddings: false,
        supportsVision: false,
      },
    };

    const provider = await svc.addProvider(draft);

    expect(provider.id).toBeTruthy();
    expect(provider.displayName).toBe('OpenAI');
    expect(provider.createdAt).toBe(1000);

    // in-memory
    const data = svc.getPluginData();
    expect(data.providers).toHaveLength(1);
    expect(data.providers[0].id).toBe(provider.id);

    // on disk
    const diskData = await readDiskJson<{ providers: Array<{ displayName: string }> }>(dataStore, paths.pluginDataFile);
    expect(diskData.providers).toHaveLength(1);
    expect(diskData.providers[0].displayName).toBe('OpenAI');
  });

  // ── Test 8: deleteProvider() ──────────────────────────────────────────────
  it('deleteProvider(): removes provider by id and saves updated data.json', async () => {
    const { svc, dataStore, paths } = makeService();
    await svc.loadAll();

    const draft = {
      displayName: 'Removable',
      kind: 'openai-compatible' as const,
      baseUrl: 'https://example.com',
      apiKey: 'key',
      defaultModel: 'model',
      timeoutMs: 5000,
      capabilities: {
        supportsJsonMode: false,
        supportsStreaming: false,
        supportsTools: false,
        supportsTemperature: false,
        supportsMaxTokens: false,
        maxTokensFieldName: 'max_tokens' as const,
        supportsEmbeddings: false,
        supportsVision: false,
      },
    };

    const p1 = await svc.addProvider({ ...draft, displayName: 'Keep' });
    const p2 = await svc.addProvider({ ...draft, displayName: 'Delete' });
    expect(svc.getPluginData().providers).toHaveLength(2);

    await svc.deleteProvider(p2.id);

    const providers = svc.getPluginData().providers;
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe(p1.id);

    // disk
    const diskData = await readDiskJson<{ providers: Array<{ displayName: string }> }>(dataStore, paths.pluginDataFile);
    expect(diskData.providers).toHaveLength(1);
    expect(diskData.providers[0].displayName).toBe('Keep');
  });

  // ── Test 9: setTaskAssignment('rerank', assignment) ───────────────────────
  it('setTaskAssignment(): stores assignment in taskAssignments on disk', async () => {
    const { svc, dataStore, paths } = makeService();
    await svc.loadAll();

    const assignment: TaskAssignment = {
      providerId: 'p1',
      model: 'rerank-model',
      enabled: true,
    };

    await svc.setTaskAssignment('rerank', assignment);

    const data = svc.getPluginData();
    expect(data.taskAssignments.rerank).toEqual(assignment);

    const diskData = await readDiskJson<{ taskAssignments: Record<string, unknown> }>(dataStore, paths.pluginDataFile);
    expect(diskData.taskAssignments['rerank']).toEqual(assignment);
  });

  // ── Test 10: setTaskAssignment('rerank', null) ────────────────────────────
  it('setTaskAssignment(null): removes key from taskAssignments on disk', async () => {
    const { svc, dataStore, paths } = makeService();
    await svc.loadAll();

    const assignment: TaskAssignment = { providerId: 'p1', model: 'rerank-model' };
    await svc.setTaskAssignment('rerank', assignment);
    expect(svc.getPluginData().taskAssignments.rerank).toBeDefined();

    await svc.setTaskAssignment('rerank', null);

    expect(svc.getPluginData().taskAssignments.rerank).toBeUndefined();
    expect('rerank' in svc.getPluginData().taskAssignments).toBe(false);

    const diskData = await readDiskJson<{ taskAssignments: Record<string, unknown> }>(dataStore, paths.pluginDataFile);
    expect('rerank' in diskData.taskAssignments).toBe(false);
  });

  // ── Test 11: readPluginData() JSON parse failure ──────────────────────────
  it('readPluginData() private path: parse failure → warn + return DEFAULT_PLUGIN_DATA', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/plugin');
    const clock = makeFakeClock(1000);

    const warnFn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: warnFn, error: vi.fn(), setLevel: vi.fn() };

    // write invalid JSON to data.json
    await adapter.writeAtomic(paths.pluginDataFile, '{ invalid json !!!');

    const svc = new NotebookService({ dataStore: adapter, paths, clock, logger });
    await svc.loadAll();

    // should fall back to defaults
    const data = svc.getPluginData();
    expect(data.schemaVersion).toBe(1);
    expect(data.providers).toEqual([]);
    expect(data.taskAssignments).toEqual({});

    // logger.warn should have been called
    expect(warnFn).toHaveBeenCalledOnce();
    expect(warnFn.mock.calls[0][0]).toContain('parse failed');
  });
});
