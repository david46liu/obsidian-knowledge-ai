import { describe, it, expect } from 'vitest';
import { scanHeadings, buildHeadingPath } from 'src/chunking/headings';

describe('scanHeadings', () => {
  it('recognises atx headings of all levels', () => {
    const text = '# a\n## b\n### c\n#### d\n##### e\n###### f\n';
    const heads = scanHeadings(text);
    expect(heads.map(h => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(heads.map(h => h.text)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('strips trailing # and whitespace', () => {
    expect(scanHeadings('## Title ##')).toEqual([
      { line: 0, level: 2, text: 'Title', charStart: 0, charEnd: 11 },
    ]);
  });

  it('ignores # inside fenced code block (backticks)', () => {
    const text = '# real\n```\n# not-a-heading\n```\n';
    const heads = scanHeadings(text);
    expect(heads.map(h => h.text)).toEqual(['real']);
  });

  it('ignores # inside fenced code block (tildes)', () => {
    const text = '~~~\n# not\n~~~\n# real\n';
    const heads = scanHeadings(text);
    expect(heads.map(h => h.text)).toEqual(['real']);
  });

  it('does not recognise setext heading', () => {
    expect(scanHeadings('Title\n===\n')).toEqual([]);
  });

  it('does not recognise # inside blockquote', () => {
    expect(scanHeadings('> # quoted\n')).toEqual([]);
  });

  it('charStart / charEnd point at raw line offsets', () => {
    const text = 'prefix\n## sec\ntail';
    const [h] = scanHeadings(text);
    expect(text.substring(h.charStart, h.charEnd)).toBe('## sec');
  });
});

describe('buildHeadingPath', () => {
  it('empty stack → push level 1', () => {
    expect(buildHeadingPath([], { level: 1, text: 'A' })).toEqual(['A']);
  });

  it('deeper pushes onto stack', () => {
    expect(buildHeadingPath(['A'], { level: 2, text: 'B' })).toEqual(['A', 'B']);
  });

  it('same level replaces top of same level', () => {
    expect(buildHeadingPath(['A', 'B'], { level: 2, text: 'B2' })).toEqual(['A', 'B2']);
  });

  it('shallower pops deeper entries', () => {
    expect(buildHeadingPath(['A', 'B', 'C'], { level: 2, text: 'B2' })).toEqual(['A', 'B2']);
  });

  it('jumping from 3 to 1 pops everything', () => {
    expect(buildHeadingPath(['A', 'B', 'C'], { level: 1, text: 'X' })).toEqual(['X']);
  });

  it('**pure function**: does not mutate caller stack', () => {
    const stack: Array<{ level: number; text: string }> = [
      { level: 1, text: 'A' }, { level: 2, text: 'B' },
    ];
    const snapshot = JSON.parse(JSON.stringify(stack));
    buildHeadingPath(stack, { level: 2, text: 'B2' });
    expect(stack).toEqual(snapshot);
  });

  it('simulated iterative indexing: # A / ## B / # C → chunks under C do not duplicate A', () => {
    const stack: Array<{ level: number; text: string }> = [];
    const paths: string[][] = [];

    for (const h of [{ level: 1, text: 'A' }, { level: 2, text: 'B' }, { level: 1, text: 'C' }]) {
      paths.push(buildHeadingPath(stack, h));
      while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
      stack.push(h);
    }

    expect(paths).toEqual([
      ['A'],
      ['A', 'B'],
      ['C'],
    ]);
  });
});
