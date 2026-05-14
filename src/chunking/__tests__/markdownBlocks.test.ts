import { describe, it, expect } from 'vitest';
import { scanBlocks } from 'src/chunking/markdownBlocks';

describe('scanBlocks', () => {
  it('empty input → []', () => {
    expect(scanBlocks('')).toEqual([]);
  });

  it('pure whitespace → []', () => {
    expect(scanBlocks('   \n\n\n')).toEqual([]);
  });

  it('single paragraph', () => {
    const blocks = scanBlocks('hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('paragraph');
    expect(blocks[0].text).toBe('hello world');
  });

  it('two paragraphs separated by blank line', () => {
    const blocks = scanBlocks('one\n\ntwo');
    expect(blocks).toHaveLength(2);
    expect(blocks.map(b => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect(blocks.map(b => b.text)).toEqual(['one', 'two']);
  });

  it('heading becomes its own block', () => {
    const blocks = scanBlocks('# Title\nbody text');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe('heading');
    expect(blocks[0].text).toBe('# Title');
    expect(blocks[1].kind).toBe('paragraph');
    expect(blocks[1].text).toBe('body text');
  });

  it('fenced code block includes fences', () => {
    const src = '```js\nconst x = 1;\n```\nafter';
    const blocks = scanBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe('code');
    expect(blocks[0].text).toBe('```js\nconst x = 1;\n```');
    expect(blocks[1].kind).toBe('paragraph');
  });

  it('list block collects consecutive items with inner blank line', () => {
    const src = '- a\n- b\n\n- c\n\ntail';
    const blocks = scanBlocks(src);
    expect(blocks.map(b => b.kind)).toEqual(['list', 'paragraph']);
    expect(blocks[0].text).toBe('- a\n- b\n\n- c');
  });

  it('table block', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntail';
    const blocks = scanBlocks(src);
    expect(blocks.map(b => b.kind)).toEqual(['table', 'paragraph']);
  });

  it('recognises ordered list starting with 1.', () => {
    const blocks = scanBlocks('1. a\n2. b');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('list');
  });

  it('offsets satisfy content.substring(charStart, charEnd) = block.text', () => {
    const src = 'first\n\nsecond';
    const blocks = scanBlocks(src);
    for (const b of blocks) {
      expect(src.substring(b.charStart, b.charEnd)).toBe(b.text);
    }
  });
});
