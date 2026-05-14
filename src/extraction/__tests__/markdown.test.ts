import { describe, it, expect } from 'vitest';
import { markdownExtractor } from 'src/extraction/markdown';

describe('markdownExtractor', () => {
  it('decodes utf-8 bytes back to string', async () => {
    const bytes = new TextEncoder().encode('# 你好\n\n世界').buffer;
    const r = await markdownExtractor.extract(bytes);
    expect(r.markdown).toBe('# 你好\n\n世界');
    expect(r.locatorMap).toEqual([]);
  });

  it('handles empty bytes', async () => {
    const r = await markdownExtractor.extract(new ArrayBuffer(0));
    expect(r.markdown).toBe('');
    expect(r.locatorMap).toEqual([]);
  });

  it('strips UTF-8 BOM transparently (TextDecoder default)', async () => {
    const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, 0x68, 0x69]).buffer;
    const r = await markdownExtractor.extract(bytes);
    expect(r.markdown).toBe('hi');
  });

  it('extension list includes md and txt', () => {
    expect([...markdownExtractor.extensions].sort()).toEqual(['md', 'txt']);
  });

  it('version is 1', () => {
    expect(markdownExtractor.version).toBe(1);
  });
});
