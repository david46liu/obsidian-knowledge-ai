import { describe, it, expect } from 'vitest';
import { DataStoreAdapter } from 'src/adapters/DataStoreAdapter';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';

describe('DataStoreAdapter', () => {
  it('abs path passthrough: writeAtomic then read using absolute path does not double-join', async () => {
    const base = join(tmpdir(), `datastore-test-${Date.now()}`);
    await fs.mkdir(base, { recursive: true });
    try {
      const adapter = new DataStoreAdapter(base);
      const absPath = join(base, 'cache', 'hashes.jsonl');

      // Writing with absolute path should create the file at exactly absPath
      await adapter.writeAtomic(absPath, 'test-content');
      const read = await adapter.read(absPath);
      expect(read).toBe('test-content');

      // Verify the file is at absPath, not at base/base/cache/hashes.jsonl
      const stat = await fs.stat(absPath);
      expect(stat.isFile()).toBe(true);
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
