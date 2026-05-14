// src/extraction/xlsx/__tests__/extractor.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { xlsxExtractor } from '../extractor';

const FIXTURES = join(__dirname, '..', '..', '__tests__', 'fixtures');
// Safe pattern — avoids Node Buffer pool slice trap
const load = (name: string) => {
  const buf = readFileSync(join(FIXTURES, name));
  return new Uint8Array(buf).buffer;
};

describe('xlsxExtractor', () => {
  it('单 sheet → markdown table + locator', async () => {
    const r = await xlsxExtractor.extract(load('single-sheet.xlsx'));
    expect(r.markdown).toContain('Sheet1');
    expect(r.markdown).toContain('Alice');
    expect(r.markdown).toContain('Bob');

    expect(r.locatorMap.length).toBeGreaterThanOrEqual(3);
    expect(r.locatorMap[0].locator).toMatchObject({
      kind: 'sheet', name: 'Sheet1', rowRange: [1, 1],
    });
  });

  it('多 sheet — 每个 sheet 独立 section + locator', async () => {
    const r = await xlsxExtractor.extract(load('multi-sheet.xlsx'));
    expect(r.markdown).toMatch(/##\s+First/);
    expect(r.markdown).toMatch(/##\s+Second/);

    const sheetNames = new Set(
      r.locatorMap.map(e => (e.locator.kind === 'sheet' ? e.locator.name : '')),
    );
    expect(sheetNames).toEqual(new Set(['First', 'Second']));
  });

  it('隐藏 sheet 被跳过', async () => {
    const r = await xlsxExtractor.extract(load('with-hidden.xlsx'));
    expect(r.markdown).toContain('Visible');
    expect(r.markdown).not.toContain('Hidden data');
    expect(r.markdown).not.toContain('Hidden');
    expect(r.markdown).not.toMatch(/##\s+Hidden/);
  });

  it('1000 行大表格全部 locatorMap 段在序', async () => {
    const r = await xlsxExtractor.extract(load('large-1000-rows.xlsx'));
    expect(r.locatorMap.length).toBeGreaterThanOrEqual(1000);
    for (let i = 1; i < r.locatorMap.length; i++) {
      expect(r.locatorMap[i].charStart).toBeGreaterThanOrEqual(r.locatorMap[i - 1].charEnd);
    }
  });

  it('损坏文件抛 Error', async () => {
    await expect(xlsxExtractor.extract(load('corrupt.xlsx'))).rejects.toThrow();
  });
});
