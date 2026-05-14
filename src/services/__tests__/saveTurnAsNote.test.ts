import { describe, it, expect } from 'vitest';
import { buildNoteFilename, buildNoteMarkdown } from 'src/services/saveTurnAsNote';
import type { Citation } from 'src/types/chat';

const T = new Date('2026-05-12T15:30:12');

describe('buildNoteFilename', () => {
  it('truncates question to 20 chars and appends timestamp', () => {
    const name = buildNoteFilename('什么是 RAG 检索增强生成 (Retrieval-Augmented Generation)', T);
    expect(name).toBe('什么是 RAG 检索增强生成 (Retr 2026-05-12 15-30-12.md');
  });

  it('replaces illegal filename chars with dash', () => {
    const name = buildNoteFilename('a/b:c*d?"e<f>g|h\\i', T);
    // 12 input chars after `a` survive, all replaced to '-'
    expect(name).toBe('a-b-c-d--e-f-g-h-i 2026-05-12 15-30-12.md');
  });

  it('trims leading and trailing dots/spaces', () => {
    const name = buildNoteFilename('   . hello world .  ', T);
    expect(name).toBe('hello world 2026-05-12 15-30-12.md');
  });

  it('handles empty question by using only timestamp', () => {
    const name = buildNoteFilename('', T);
    expect(name).toBe('2026-05-12 15-30-12.md');
  });

  it('handles question that is entirely illegal chars by using timestamp only', () => {
    const name = buildNoteFilename('?/<>', T);
    // After replace and trim, becomes empty
    expect(name).toBe('2026-05-12 15-30-12.md');
  });

  it('counts CJK chars as 1 each, includes ASCII letters up to 20', () => {
    const name = buildNoteFilename('一二三四五六七八九十1234567890abc', T);
    expect(name.startsWith('一二三四五六七八九十1234567890 ')).toBe(true);
  });

  it('pads single-digit hours/minutes/seconds with zero', () => {
    const t = new Date('2026-01-02T03:04:05');
    expect(buildNoteFilename('q', t)).toBe('q 2026-01-02 03-04-05.md');
  });
});

function cite(index: number, overrides: Partial<Citation> = {}): Citation {
  return {
    index,
    chunkId: `c${index}`,
    filePath: `notes/file${index}.md`,
    headingPath: ['Section', `Sub ${index}`],
    charStart: index * 100,
    charEnd: index * 100 + 80,
    preview: `preview text for citation ${index}`,
    ...overrides,
  };
}

describe('buildNoteMarkdown', () => {
  it('renders question H1, metadata blockquote, content, and citations', () => {
    const md = buildNoteMarkdown({
      userQuestion: '什么是 RAG?',
      assistantContent: 'RAG 是 [1] 检索增强生成。',
      notebookName: '我的笔记本',
      timestamp: T,
      citations: [cite(1)],
    });
    expect(md).toContain('# 什么是 RAG?');
    expect(md).toContain('> 2026-05-12 15:30:12 — 我的笔记本');
    expect(md).toContain('RAG 是 [1] 检索增强生成。');
    expect(md).toContain('## 引用');
    expect(md).toContain('### [1] Section > Sub 1');
    expect(md).toContain('源文件: [[notes/file1.md]]');
    expect(md).toContain('字符偏移: 100–180');
    expect(md).toContain('> preview text for citation 1');
  });

  it('omits citations section when no citations', () => {
    const md = buildNoteMarkdown({
      userQuestion: 'q',
      assistantContent: 'a',
      notebookName: 'nb',
      timestamp: T,
      citations: [],
    });
    expect(md).not.toContain('## 引用');
  });

  it('shows (无标题) when headingPath is empty', () => {
    const md = buildNoteMarkdown({
      userQuestion: 'q',
      assistantContent: 'a',
      notebookName: 'nb',
      timestamp: T,
      citations: [cite(1, { headingPath: [] })],
    });
    expect(md).toContain('### [1] (无标题)');
  });

  it('renders multiple citations in order', () => {
    const md = buildNoteMarkdown({
      userQuestion: 'q',
      assistantContent: 'a',
      notebookName: 'nb',
      timestamp: T,
      citations: [cite(2), cite(1), cite(3)],
    });
    const idx1 = md.indexOf('### [1]');
    const idx2 = md.indexOf('### [2]');
    const idx3 = md.indexOf('### [3]');
    expect(idx1).toBeGreaterThan(0);
    expect(idx2).toBeGreaterThan(0);
    expect(idx3).toBeGreaterThan(0);
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  it('uses (无对应问题) when userQuestion is empty', () => {
    const md = buildNoteMarkdown({
      userQuestion: '',
      assistantContent: 'a',
      notebookName: 'nb',
      timestamp: T,
      citations: [],
    });
    expect(md).toContain('# (无对应问题)');
  });
});
