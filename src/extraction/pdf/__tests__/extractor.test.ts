import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pdfExtractor } from '../extractor';

const FIXTURES = join(__dirname, '..', '..', '__tests__', 'fixtures');

const load = (name: string) => {
  const buf = readFileSync(join(FIXTURES, name));
  return new Uint8Array(buf).buffer;
};

describe('pdfExtractor', () => {
  it('2 页 PDF → 两段 markdown,locatorMap 各对应 page N', async () => {
    const r = await pdfExtractor.extract(load('simple.pdf'));
    expect(r.markdown).toMatch(/##\s+Page\s+1/);
    expect(r.markdown).toMatch(/##\s+Page\s+2/);
    expect(r.markdown).toContain('Page one content');
    expect(r.markdown).toContain('Page two content');

    const pages = r.locatorMap.filter(e => e.locator.kind === 'page');
    expect(pages.length).toBe(2);
    expect(pages[0].locator.kind === 'page' && pages[0].locator.pageRange).toEqual([1, 1]);
    expect(pages[1].locator.kind === 'page' && pages[1].locator.pageRange).toEqual([2, 2]);
  });

  it('locatorMap charStart/charEnd 覆盖全 markdown', async () => {
    const r = await pdfExtractor.extract(load('simple.pdf'));
    expect(r.locatorMap[0].charStart).toBe(0);
    expect(r.locatorMap[r.locatorMap.length - 1].charEnd).toBe(r.markdown.length);
  });

  it('charEnd[i] === charStart[i+1] — 区间连续无间隙', async () => {
    const r = await pdfExtractor.extract(load('simple.pdf'));
    for (let i = 0; i < r.locatorMap.length - 1; i++) {
      expect(r.locatorMap[i].charEnd).toBe(r.locatorMap[i + 1].charStart);
    }
  });

  it('损坏文件抛 Error', async () => {
    await expect(pdfExtractor.extract(load('corrupt.pdf'))).rejects.toThrow();
  });
});
