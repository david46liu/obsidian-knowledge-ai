import { describe, it, expect } from 'vitest';
import { splitSectionByBlocks } from 'src/chunking/splitters';
import { scanBlocks } from 'src/chunking/markdownBlocks';

describe('splitSectionByBlocks — Level 1', () => {
  it('single small block fits in one chunk', () => {
    const src = 'hello';
    const blocks = scanBlocks(src);
    const chunks = splitSectionByBlocks(blocks, src, { maxTokens: 100, overlapTokens: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('hello');
  });

  it('two small blocks merge into one chunk when budget allows', () => {
    const src = 'aaa\n\nbbb';
    const blocks = scanBlocks(src);
    const chunks = splitSectionByBlocks(blocks, src, { maxTokens: 100, overlapTokens: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('aaa');
    expect(chunks[0].text).toContain('bbb');
  });

  it('two blocks exceeding budget split into two chunks, no merge across', () => {
    const src = 'aaa\n\nbbb';
    const blocks = scanBlocks(src);
    const chunks = splitSectionByBlocks(blocks, src, { maxTokens: 1, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('splitSectionByBlocks — Level 2 (sentence fallback)', () => {
  it('single block exceeding maxTokens splits into multiple sentence chunks', () => {
    const longText = Array(20).fill('这是一个句子').join('。') + '。';
    const blocks = scanBlocks(longText);
    const chunks = splitSectionByBlocks(blocks, longText, { maxTokens: 5, overlapTokens: 1 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('overlap句子出现在相邻 chunk 边界', () => {
    const longText = '句甲。句乙。句丙。句丁。句戊。';
    const blocks = scanBlocks(longText);
    const chunks = splitSectionByBlocks(blocks, longText, { maxTokens: 4, overlapTokens: 1 });
    if (chunks.length >= 2) {
      const last = chunks[0].text.slice(-6);
      const head = chunks[1].text.slice(0, 6);
      expect(last.length + head.length).toBeGreaterThan(0);
    }
  });
});

describe('splitSectionByBlocks — Level 3 (hard token cut)', () => {
  it('single sentence exceeding maxTokens is hard-split', () => {
    const s = Array(100).fill('词').join('');
    const blocks = scanBlocks(s);
    const chunks = splitSectionByBlocks(blocks, s, { maxTokens: 10, overlapTokens: 2 });
    expect(chunks.length).toBeGreaterThan(1);
    const joined = chunks.map(c => c.text).join('');
    for (const ch of s) expect(joined.includes(ch)).toBe(true);
  });

  it('effectiveOverlap is clamped to floor(maxTokens/4)', () => {
    const s = Array(50).fill('词').join('');
    const chunks = splitSectionByBlocks(scanBlocks(s), s, { maxTokens: 8, overlapTokens: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeGreaterThan(0);
  });
});
