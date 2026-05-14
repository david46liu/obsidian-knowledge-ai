import { describe, it, expect } from 'vitest';
import { parseMindMap } from 'src/generation/mindmap';

describe('parseMindMap', () => {
  it('parses a single root node', () => {
    const { root, errors } = parseMindMap('- root');
    expect(root).not.toBeNull();
    expect(root?.text).toBe('root');
    expect(root?.children).toHaveLength(0);
    expect(root?.citationIndices).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('parses three-level tree: root + 2 children + 1 grandchild', () => {
    const md = [
      '- root',
      '  - childA',
      '    - grandA',
      '  - childB',
    ].join('\n');
    const { root, errors } = parseMindMap(md);
    expect(errors).toEqual([]);
    expect(root).not.toBeNull();
    expect(root?.text).toBe('root');
    expect(root?.children).toHaveLength(2);
    expect(root?.children[0].text).toBe('childA');
    expect(root?.children[1].text).toBe('childB');
    expect(root?.children[0].children).toHaveLength(1);
    expect(root?.children[0].children[0].text).toBe('grandA');
    expect(root?.children[1].children).toHaveLength(0);
    // id 自增
    expect(root?.id).toBe('0');
    expect(root?.children[0].id).toBe('1');
    expect(root?.children[0].children[0].id).toBe('2');
    expect(root?.children[1].id).toBe('3');
  });

  it('extracts trailing citations "- 节点 [3][7]"', () => {
    const { root, errors } = parseMindMap('- 节点 [3][7]');
    expect(errors).toEqual([]);
    expect(root?.text).toBe('节点');
    expect(root?.citationIndices).toEqual([3, 7]);
  });

  it('extracts trailing citation without space "- 节点[3]"', () => {
    const { root, errors } = parseMindMap('- 节点[3]');
    expect(errors).toEqual([]);
    expect(root?.text).toBe('节点');
    expect(root?.citationIndices).toEqual([3]);
  });

  it('only treats trailing [N] as citations; mid-text [5] kept in text', () => {
    const { root, errors } = parseMindMap('- 中间[5]文本 [3]');
    expect(errors).toEqual([]);
    expect(root?.text).toBe('中间[5]文本');
    expect(root?.citationIndices).toEqual([3]);
  });

  it('reports error on indent that is not a multiple of 2', () => {
    const md = [
      '- root',
      '   - bad-indent',
    ].join('\n');
    const { root, errors } = parseMindMap(md);
    expect(root).not.toBeNull();
    expect(root?.text).toBe('root');
    expect(root?.children).toHaveLength(0);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some(e => /indent/.test(e))).toBe(true);
  });

  it('attaches a second top-level root as a child of the first, with warning', () => {
    const md = [
      '- root1',
      '- root2',
    ].join('\n');
    const { root, errors } = parseMindMap(md);
    expect(root).not.toBeNull();
    expect(root?.text).toBe('root1');
    expect(root?.children).toHaveLength(1);
    expect(root?.children[0].text).toBe('root2');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some(e => /extra root/i.test(e))).toBe(true);
  });

  it('skips orphan node (depth jump without parent), pushes error', () => {
    const md = [
      '- root',
      '      - 跳级孤儿(应被跳过)',
      '  - 正常孩子',
    ].join('\n');
    const { root, errors } = parseMindMap(md);
    expect(root).not.toBeNull();
    expect(root?.text).toBe('root');
    // 跳级孤儿被跳过(depth=3 但 stack[2] 不存在),孩子 depth=1 正常挂上
    expect(root?.children).toHaveLength(1);
    expect(root?.children[0].text).toBe('正常孩子');
    expect(errors.some(e => /孤儿|orphan/.test(e))).toBe(true);
  });

  it('skips blank lines and stray non-list text, parsing root + child correctly', () => {
    const md = [
      '',
      '这是 LLM 多嘴的解释',
      '- root',
      '',
      '  - child',
      '另外一句解释',
    ].join('\n');
    const { root, errors } = parseMindMap(md);
    expect(root).not.toBeNull();
    expect(root?.text).toBe('root');
    expect(root?.children).toHaveLength(1);
    expect(root?.children[0].text).toBe('child');
    // 两条非 list 文本应触发 errors(空行不计)
    const skippedCount = errors.filter(e => /skipped/.test(e)).length;
    expect(skippedCount).toBeGreaterThanOrEqual(2);
  });
});
