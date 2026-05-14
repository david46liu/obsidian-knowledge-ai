import { describe, it, expect } from 'vitest';
import { readJson, writeJson } from 'src/storage/json';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';

describe('readJson', () => {
  it('returns null when file does not exist', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const result = await readJson(adapter, 'missing.json');
    expect(result).toBeNull();
  });

  it('parses existing file', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    await adapter.writeAtomic('data.json', JSON.stringify({ x: 1 }));
    const result = await readJson<{ x: number }>(adapter, 'data.json');
    expect(result).toEqual({ x: 1 });
  });

  it('returns null on corrupted JSON', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    await adapter.writeAtomic('data.json', '{corrupted');
    const result = await readJson(adapter, 'data.json');
    expect(result).toBeNull();
  });
});

describe('writeJson', () => {
  it('writes serialized JSON', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    await writeJson(adapter, 'out.json', { hello: 'world' });
    const raw = await adapter.read('out.json');
    expect(JSON.parse(raw!)).toEqual({ hello: 'world' });
  });

  it('writes pretty-printed JSON with 2-space indent', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    await writeJson(adapter, 'out.json', { hello: 'world' });
    const raw = await adapter.read('out.json');
    expect(raw).toBe('{\n  "hello": "world"\n}');
  });
});
