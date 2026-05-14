import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { docxExtractor } from '../extractor';

const FIXTURES = join(__dirname, '..', '..', '__tests__', 'fixtures');
const load = (name: string) => {
  const buf = readFileSync(join(FIXTURES, name));
  return new Uint8Array(buf).buffer;   // 始终产生 byteOffset=0 的独立 ArrayBuffer
};

describe('docxExtractor', () => {
  it('extensions 与 version', () => {
    expect(docxExtractor.extensions).toEqual(['docx']);
    expect(docxExtractor.version).toBeGreaterThan(0);
  });

  it('简单文档 → markdown 含标题与正文', async () => {
    const r = await docxExtractor.extract(load('simple.docx'));
    expect(r.markdown).toContain('简单文档');
    expect(r.markdown).toContain('这是正文');
    expect(r.locatorMap).toEqual([]);   // docx v1 不做内分页
  });

  it('多级标题保留层级', async () => {
    const r = await docxExtractor.extract(load('with-headings.docx'));
    expect(r.markdown).toMatch(/^#\s+一级/m);
    expect(r.markdown).toMatch(/^##\s+二级/m);
    expect(r.markdown).toMatch(/^###\s+三级/m);
  });

  it('表格转 markdown table', async () => {
    const r = await docxExtractor.extract(load('with-tables.docx'));
    expect(r.markdown).toMatch(/\|.*A.*\|.*B.*\|/);
    expect(r.markdown).toMatch(/\|.*1.*\|.*2.*\|/);
  });

  it('损坏文件抛 Error', async () => {
    await expect(docxExtractor.extract(load('corrupt.docx'))).rejects.toThrow();
  });
});
