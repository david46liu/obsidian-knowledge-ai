import { describe, it, expect } from 'vitest';
import { estimateTokens, segmentWords } from 'src/chunking/tokenize';

describe('estimateTokens', () => {
  it('empty string → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('pure whitespace → 0', () => {
    expect(estimateTokens('   \n\t  ')).toBe(0);
  });

  it('english sentence produces multiple segments', () => {
    const n = estimateTokens('Hello world, this is a test.');
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('cjk text produces multiple segments (char-level-ish)', () => {
    const n = estimateTokens('这是一个中文测试句子');
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it('same input → stable count', () => {
    const s = '混合 English 和中文 content 123';
    expect(estimateTokens(s)).toBe(estimateTokens(s));
  });
});

describe('segmentWords', () => {
  it('returns ordered segments, whitespace excluded', () => {
    const segs = segmentWords('ab cd');
    expect(segs.every(s => s.trim().length > 0)).toBe(true);
    expect(segs.join('')).toMatch(/ab.*cd/);
  });

  it('empty string → []', () => {
    expect(segmentWords('')).toEqual([]);
  });
});
