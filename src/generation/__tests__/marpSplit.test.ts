import { describe, it, expect } from 'vitest';
import { splitMarpSlides } from 'src/generation/marpSplit';

describe('splitMarpSlides', () => {
  it('returns single slide when no separator present', () => {
    const md = '# 唯一一页\n\n一些内容';
    const slides = splitMarpSlides(md);
    expect(slides).toHaveLength(1);
    expect(slides[0]).toBe('# 唯一一页\n\n一些内容');
  });

  it('splits three slides separated by two `---`', () => {
    const md = [
      '# 封面',
      '',
      '---',
      '',
      '## 第二页',
      '- 要点 A',
      '',
      '---',
      '',
      '## 总结',
      '- 收尾',
    ].join('\n');
    const slides = splitMarpSlides(md);
    expect(slides).toHaveLength(3);
    expect(slides[0]).toBe('# 封面');
    expect(slides[1]).toBe('## 第二页\n- 要点 A');
    expect(slides[2]).toBe('## 总结\n- 收尾');
  });

  it('splits even when there are no blank lines around `---`', () => {
    const md = '# A\n---\n# B';
    const slides = splitMarpSlides(md);
    expect(slides).toHaveLength(2);
    expect(slides[0]).toBe('# A');
    expect(slides[1]).toBe('# B');
  });

  it('skips leading frontmatter block', () => {
    const md = '---\nmarp: true\n---\n# A\n---\n# B';
    const slides = splitMarpSlides(md);
    expect(slides).toEqual(['# A', '# B']);
  });

  it('trims surrounding whitespace per slide', () => {
    const md = '# A\n\n\n---\n\n\n# B';
    const slides = splitMarpSlides(md);
    expect(slides).toHaveLength(2);
    expect(slides[0]).toBe('# A');
    expect(slides[1]).toBe('# B');
  });

  it('skips trailing empty slide produced by terminal `---`', () => {
    const md = '# A\n---\n';
    const slides = splitMarpSlides(md);
    expect(slides).toEqual(['# A']);
  });
});
