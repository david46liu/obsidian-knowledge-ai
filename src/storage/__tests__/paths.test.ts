import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { StoragePaths } from 'src/storage/paths';

describe('StoragePaths', () => {
  const base = join('.obsidian', 'plugins', 'notebook-ai');
  const p = new StoragePaths(base);

  it('notebookFile returns correct path', () => {
    expect(p.notebookFile('abc-123')).toBe(
      join(base, 'notebooks', 'abc-123.json')
    );
  });

  it('indexFile returns correct path', () => {
    expect(p.indexFile('nb-1')).toBe(
      join(base, 'indexes', 'nb-1.msearch.json')
    );
  });

  it('hashesJsonl is fixed path', () => {
    expect(p.hashesJsonl).toBe(
      join(base, 'cache', 'hashes.jsonl')
    );
  });

  it('pathsJsonl is fixed path', () => {
    expect(p.pathsJsonl).toBe(
      join(base, 'cache', 'paths.jsonl')
    );
  });

  it('compactLock is fixed path', () => {
    expect(p.compactLock).toBe(
      join(base, 'cache', '.compact.lock')
    );
  });

  it('tmpFile appends .tmp', () => {
    expect(p.tmpFile(p.hashesJsonl)).toBe(p.hashesJsonl + '.tmp');
  });

  it('sessionsDir returns correct path', () => {
    expect(p.sessionsDir('nb-1')).toBe(
      join(base, 'notebooks', 'nb-1', 'conversations')
    );
  });

  it('sessionFile returns correct path', () => {
    expect(p.sessionFile('nb-1', 'sess-abc')).toBe(
      join(base, 'notebooks', 'nb-1', 'conversations', 'sess-abc.json')
    );
  });

  it('artifactsDir returns correct path', () => {
    expect(p.artifactsDir('nb-1')).toBe(
      join(base, 'notebooks', 'nb-1', 'artifacts')
    );
  });

  it('artifactFile returns correct path', () => {
    expect(p.artifactFile('nb-1', 'art-abc')).toBe(
      join(base, 'notebooks', 'nb-1', 'artifacts', 'art-abc.json')
    );
  });
});
