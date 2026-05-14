import { describe, it, expect } from 'vitest';
import { chunkFile } from 'src/chunking/chunkFile';

const SAMPLE = `# 项目 A

## 背景

这是一段背景介绍,说明项目的由来。背景还有一句补充。

## 需求

### 功能需求

需求一描述。

需求二描述。

### 非功能需求

性能要求:QPS > 1000。

\`\`\`ts
const config = { timeout: 3000 };
\`\`\`

## 风险

- 风险 1
- 风险 2
- 风险 3
`;

describe('chunking integration', () => {
  it('produces non-empty chunks with ordered indices', async () => {
    const chunks = await chunkFile(SAMPLE, {
      filePath: 'a.md',
      sourceId: 's',
      fileHash: 'h',
      config: { maxTokens: 60, overlapTokens: 10 },
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map(c => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it('every chunk has non-empty content and valid hash', async () => {
    const chunks = await chunkFile(SAMPLE, {
      filePath: 'a.md', sourceId: 's', fileHash: 'h',
      config: { maxTokens: 60, overlapTokens: 10 },
    });
    for (const c of chunks) {
      expect(c.content.length).toBeGreaterThan(0);
      expect(c.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(c.tokenCount).toBeGreaterThan(0);
    }
  });

  it('charStart < charEnd and ranges cover non-overlapping-ish source', async () => {
    const chunks = await chunkFile(SAMPLE, {
      filePath: 'a.md', sourceId: 's', fileHash: 'h',
      config: { maxTokens: 60, overlapTokens: 10 },
    });
    for (const c of chunks) {
      expect(c.charStart).toBeLessThan(c.charEnd);
      expect(c.charEnd).toBeLessThanOrEqual(SAMPLE.length);
    }
  });

  it('headingPath depth reflects nesting on at least one chunk', async () => {
    const chunks = await chunkFile(SAMPLE, {
      filePath: 'a.md', sourceId: 's', fileHash: 'h',
      config: { maxTokens: 60, overlapTokens: 10 },
    });
    const deep = chunks.filter(c => c.headingPath.length >= 3);
    expect(deep.length).toBeGreaterThan(0);
  });

  it('code block stays intact (kind=code or mixed)', async () => {
    const chunks = await chunkFile(SAMPLE, {
      filePath: 'a.md', sourceId: 's', fileHash: 'h',
      config: { maxTokens: 1000, overlapTokens: 10 },
    });
    const codeChunk = chunks.find(c => c.content.includes('const config'));
    expect(codeChunk).toBeDefined();
    expect(['code', 'mixed']).toContain(codeChunk!.kind);
  });
});
