import { describe, it, expect } from 'vitest';
import { InMemoryVaultAdapter } from './InMemoryVaultAdapter';

describe('InMemoryVaultAdapter binary support', () => {
  it('writeBinary + readBinary roundtrip preserves bytes', async () => {
    const v = new InMemoryVaultAdapter();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);   // ZIP magic
    v.writeBinary('a.docx', bytes);
    const read = await v.readBinary('a.docx');
    expect(new Uint8Array(read)).toEqual(bytes);
  });

  it('getFiles({extensions:["docx","md"]}) filters by extension', async () => {
    const v = new InMemoryVaultAdapter();
    v.writeFile('a.md', '# hi');
    v.writeBinary('b.docx', new Uint8Array([1, 2]));
    v.writeFile('c.txt', 'hello');
    const files = await v.getFiles({ extensions: ['docx', 'md'] });
    expect(files.map(f => f.path).sort()).toEqual(['a.md', 'b.docx']);
  });

  it('getFiles is case-insensitive on extension', async () => {
    const v = new InMemoryVaultAdapter();
    v.writeBinary('A.DOCX', new Uint8Array([1]));
    const files = await v.getFiles({ extensions: ['docx'] });
    expect(files).toHaveLength(1);
  });

  it('read on binary file decodes as utf-8', async () => {
    const v = new InMemoryVaultAdapter();
    v.writeBinary('a.txt', new TextEncoder().encode('héllo'));
    expect(await v.read('a.txt')).toBe('héllo');
  });
});
