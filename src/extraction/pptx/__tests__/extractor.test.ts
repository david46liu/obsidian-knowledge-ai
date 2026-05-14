import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pptxExtractor } from '../extractor';

const FIXTURES = join(__dirname, '..', '..', '__tests__', 'fixtures');

// Safe load helper — avoids Buffer pool trap
const load = (name: string) => {
  const buf = readFileSync(join(FIXTURES, name));
  return new Uint8Array(buf).buffer;
};

describe('pptxExtractor', () => {
  it('两张 slide → 两段 markdown,locator 各对应 slide N', async () => {
    const r = await pptxExtractor.extract(load('2-slides.pptx'));
    expect(r.markdown).toMatch(/##\s+Slide\s+1/);
    expect(r.markdown).toMatch(/##\s+Slide\s+2/);
    expect(r.markdown).toContain('开篇');
    expect(r.markdown).toContain('第二张');

    const slides = r.locatorMap.filter(
      e => e.locator.kind === 'slide' && !e.locator.isNote,
    );
    expect(slides.length).toBe(2);
    expect(slides[0].locator.kind === 'slide' && slides[0].locator.index).toBe(1);
    expect(slides[1].locator.kind === 'slide' && slides[1].locator.index).toBe(2);
  });

  it('includeNotes=false(默认)— 备注不进 markdown', async () => {
    const r = await pptxExtractor.extract(load('with-notes.pptx'));
    expect(r.markdown).not.toContain('备注内容');
    expect(
      r.locatorMap.some(
        e => e.locator.kind === 'slide' && e.locator.isNote === true,
      ),
    ).toBe(false);
  });

  it('includeNotes=true — 备注进 markdown,locator 标 isNote', async () => {
    const r = await pptxExtractor.extract(load('with-notes.pptx'), { includeNotes: true });
    expect(r.markdown).toContain('备注内容');
    const noteEntries = r.locatorMap.filter(
      e => e.locator.kind === 'slide' && e.locator.isNote === true,
    );
    expect(noteEntries.length).toBeGreaterThan(0);
  });

  it('Unicode 文本(中日英 + emoji)正确提取', async () => {
    const r = await pptxExtractor.extract(load('unicode.pptx'));
    expect(r.markdown).toContain('日本語');
    expect(r.markdown).toContain('한국어');
    expect(r.markdown).toContain('🚀');
  });

  it('损坏文件抛 Error', async () => {
    await expect(pptxExtractor.extract(load('corrupt.pptx'))).rejects.toThrow();
  });
});
