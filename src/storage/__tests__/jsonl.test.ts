import { describe, it, expect } from 'vitest';
import { appendJsonl, readJsonl } from 'src/storage/jsonl';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';

describe('appendJsonl', () => {
  it('appends JSON line terminated by newline', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    await appendJsonl(adapter, 'log.jsonl', { a: 1 });
    const raw = await adapter.read('log.jsonl');
    expect(raw).toBe('{"a":1}\n');
  });

  it('multiple appends produce multiple lines', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    await appendJsonl(adapter, 'log.jsonl', { a: 1 });
    await appendJsonl(adapter, 'log.jsonl', { b: 2 });
    const raw = await adapter.read('log.jsonl');
    expect(raw).toBe('{"a":1}\n{"b":2}\n');
  });
});

describe('readJsonl', () => {
  it('reads all valid lines', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    await adapter.writeAtomic('log.jsonl', '{"a":1}\n{"b":2}\n');
    const result = await readJsonl<{ a?: number; b?: number }>(adapter, 'log.jsonl');
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns empty array when file does not exist', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const result = await readJsonl(adapter, 'missing.jsonl');
    expect(result).toEqual([]);
  });

  it('tolerates truncated last line (no trailing newline)', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    await adapter.writeAtomic('log.jsonl', '{"a":1}\n{"truncated"');
    const result = await readJsonl<{ a?: number }>(adapter, 'log.jsonl');
    expect(result).toEqual([{ a: 1 }]);
  });

  it('skips blank lines', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    await adapter.writeAtomic('log.jsonl', '{"a":1}\n\n{"b":2}\n');
    const result = await readJsonl<{ a?: number; b?: number }>(adapter, 'log.jsonl');
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
