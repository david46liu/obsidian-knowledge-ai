import { describe, it, expect } from 'vitest';
import { chunkFile } from 'src/chunking/chunkFile';
import type { LocatorMapEntry } from 'src/extraction/types';

const FILE_HASH = '0123456789abcdef';
const SOURCE_ID = 'src-1';
const FILE_PATH = 'a.md';

describe('chunkFile', () => {
  it('empty file → []', async () => {
    const chunks = await chunkFile('', {
      filePath: FILE_PATH, sourceId: SOURCE_ID, fileHash: FILE_HASH,
      config: { maxTokens: 100, overlapTokens: 10 },
    });
    expect(chunks).toEqual([]);
  });

  it('no heading → headingPath = []', async () => {
    const chunks = await chunkFile('just a paragraph', {
      filePath: FILE_PATH, sourceId: SOURCE_ID, fileHash: FILE_HASH,
      config: { maxTokens: 100, overlapTokens: 10 },
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual([]);
    expect(chunks[0].headingText).toBe('');
    expect(chunks[0].filePath).toBe(FILE_PATH);
    expect(chunks[0].sourceId).toBe(SOURCE_ID);
    expect(chunks[0].fileHash).toBe(FILE_HASH);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].id).toBe(`${FILE_HASH}:0`);
  });

  it('chunkIndex strictly increases from 0', async () => {
    const src = '# A\n\naaa\n\n## B\n\nbbb\n\n# C\n\nccc';
    const chunks = await chunkFile(src, {
      filePath: FILE_PATH, sourceId: SOURCE_ID, fileHash: FILE_HASH,
      config: { maxTokens: 5, overlapTokens: 1 },
    });
    expect(chunks.map(c => c.chunkIndex)).toEqual(
      chunks.map((_, i) => i)
    );
  });

  it('headingPath reflects nesting', async () => {
    const src = '# A\n\naaa\n\n## B\n\nbbb';
    const chunks = await chunkFile(src, {
      filePath: FILE_PATH, sourceId: SOURCE_ID, fileHash: FILE_HASH,
      config: { maxTokens: 100, overlapTokens: 10 },
    });
    const aaa = chunks.find(c => c.content.includes('aaa'));
    const bbb = chunks.find(c => c.content.includes('bbb'));
    expect(aaa?.headingPath).toEqual(['A']);
    expect(bbb?.headingPath).toEqual(['A', 'B']);
    expect(bbb?.headingText).toBe('A > B');
  });

  it('chunk.content equals source.substring(charStart,charEnd).trim()', async () => {
    const src = '# Title\n\n  para1  \n\npara2';
    const chunks = await chunkFile(src, {
      filePath: FILE_PATH, sourceId: SOURCE_ID, fileHash: FILE_HASH,
      config: { maxTokens: 100, overlapTokens: 10 },
    });
    for (const c of chunks) {
      expect(c.content).toBe(src.substring(c.charStart, c.charEnd).trim());
    }
  });

  it('contentHash is 64-hex-char SHA-256', async () => {
    const chunks = await chunkFile('hello', {
      filePath: FILE_PATH, sourceId: SOURCE_ID, fileHash: FILE_HASH,
      config: { maxTokens: 100, overlapTokens: 10 },
    });
    expect(chunks[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('kind=mixed when chunk spans multiple block kinds', async () => {
    const src = '# H\n\npara\n\n- list item';
    const chunks = await chunkFile(src, {
      filePath: FILE_PATH, sourceId: SOURCE_ID, fileHash: FILE_HASH,
      config: { maxTokens: 1000, overlapTokens: 10 },
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('mixed');
  });

  it('respects MAX_CHUNKS_PER_FILE cap with warning field', async () => {
    const src = 'hi';
    const chunks = await chunkFile(src, {
      filePath: FILE_PATH, sourceId: SOURCE_ID, fileHash: FILE_HASH,
      config: { maxTokens: 100, overlapTokens: 10 },
    });
    expect(chunks.length).toBeLessThanOrEqual(10_000);
  });

  it('applies locator from locatorMap to chunks based on charStart', async () => {
    // 两段段落,空行分隔:para1=[0,50), para2=[51,100)
    // locatorMap 把 [0,51) 标 slide 1,[51,101) 标 slide 2
    const para1 = 'word '.repeat(10).trim(); // length=49, charStart=0
    const para2 = 'text '.repeat(10).trim(); // length=49, charStart=51
    const md = para1 + '\n\n' + para2;
    const locatorMap: LocatorMapEntry[] = [
      { charStart: 0,  charEnd: 51,  locator: { kind: 'slide', index: 1, title: 'X' } },
      { charStart: 51, charEnd: 101, locator: { kind: 'slide', index: 2, title: 'Y' } },
    ];
    const chunks = await chunkFile(md, {
      filePath: 'a.pptx',
      sourceId: 's',
      fileHash: 'h',
      config: { maxTokens: 5, overlapTokens: 1 },
      locatorMap,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const expectedIndex = c.charStart < 51 ? 1 : 2;
      expect(c.locator).toEqual(
        expect.objectContaining({ kind: 'slide', index: expectedIndex })
      );
    }
  });

  it('omits locator when locatorMap is empty or missing', async () => {
    const chunks = await chunkFile('# hi\n\nbody', {
      filePath: 'a.md',
      sourceId: 's',
      fileHash: 'h',
      config: { maxTokens: 50, overlapTokens: 5 },
    });
    for (const c of chunks) {
      expect(c.locator).toBeUndefined();
    }
  });
});
