import { describe, it, expect } from 'vitest';
import { matchesSource, matchesNotebookScope, resolveSourceId, matchesGlob } from 'src/indexer/scope';
import type { Source, Notebook } from 'src/types/data';

function src(over: Partial<Source>): Source {
  return { id: 's', type: 'folder', path: 'notes', recursive: true, ...over };
}

describe('matchesSource', () => {
  it('prefix match under source.path', () => {
    expect(matchesSource('notes/a.md', src({}))).toBe(true);
    expect(matchesSource('notes/sub/b.md', src({}))).toBe(true);
    expect(matchesSource('other/c.md', src({}))).toBe(false);
  });

  it('disabled source matches nothing', () => {
    expect(matchesSource('notes/a.md', src({ enabled: false }))).toBe(false);
  });

  it('recursive=false excludes subdirectories', () => {
    expect(matchesSource('notes/a.md', src({ recursive: false }))).toBe(true);
    expect(matchesSource('notes/sub/b.md', src({ recursive: false }))).toBe(false);
  });

  it('includeGlobs restricts extensions', () => {
    expect(matchesSource('notes/a.md', src({ includeGlobs: ['*.md'] }))).toBe(true);
    expect(matchesSource('notes/a.txt', src({ includeGlobs: ['*.md'] }))).toBe(false);
  });

  it('excludeGlobs blocks matching paths', () => {
    expect(matchesSource('notes/a.tmp', src({ excludeGlobs: ['*.tmp'] }))).toBe(false);
    expect(matchesSource('notes/a.md', src({ excludeGlobs: ['*.tmp'] }))).toBe(true);
  });

  it('default excludes reject hidden segments', () => {
    expect(matchesSource('notes/.git/a.md', src({}))).toBe(false);
    expect(matchesSource('notes/a.md', src({}))).toBe(true);
  });

  it('exact path equal to source.path', () => {
    expect(matchesSource('notes', src({}))).toBe(true);
  });
});

describe('matchesNotebookScope', () => {
  it('matches if any source matches', () => {
    const nb: Pick<Notebook, 'sources'> = {
      sources: [src({ id: 'a', path: 'a' }), src({ id: 'b', path: 'b' })],
    };
    expect(matchesNotebookScope('a/x.md', nb)).toBe(true);
    expect(matchesNotebookScope('b/x.md', nb)).toBe(true);
    expect(matchesNotebookScope('c/x.md', nb)).toBe(false);
  });
});

describe('resolveSourceId', () => {
  it('returns id of first matching source', () => {
    const nb: Pick<Notebook, 'sources'> = {
      sources: [src({ id: 'a', path: 'a' }), src({ id: 'b', path: 'b' })],
    };
    expect(resolveSourceId('a/x.md', nb)).toBe('a');
    expect(resolveSourceId('b/x.md', nb)).toBe('b');
    expect(resolveSourceId('c/x.md', nb)).toBeUndefined();
  });
});

describe('matchesGlob (globstar)', () => {
  // 1. **/templates/** 匹配多层路径下的 templates 子内容
  it('**/templates/** matches paths containing /templates/<file>', () => {
    expect(matchesGlob('AI/templates/foo.md', '**/templates/**')).toBe(true);
    expect(matchesGlob('a/b/templates/c.md', '**/templates/**')).toBe(true);
  });

  // 2. **/templates/** 不匹配 templates 末尾(无尾随内容)
  it('**/templates/** does not match path that just ends with /templates', () => {
    expect(matchesGlob('AI/templates', '**/templates/**')).toBe(false);
  });

  // 3. templates/** 匹配 templates 下任意层
  it('templates/** matches direct and nested children', () => {
    expect(matchesGlob('templates/x.md', 'templates/**')).toBe(true);
    expect(matchesGlob('templates/a/b.md', 'templates/**')).toBe(true);
  });

  // 4. templates/** 不匹配其他路径下的 templates
  it('templates/** does not match other/templates/x.md', () => {
    expect(matchesGlob('other/templates/x.md', 'templates/**')).toBe(false);
  });

  // 5. templates/**/x.md 匹配零层与多层(标准 globstar 行为:** 可匹配 0 段或多段)
  it('templates/**/x.md matches templates/x.md, templates/a/x.md, templates/a/b/x.md', () => {
    expect(matchesGlob('templates/x.md', 'templates/**/x.md')).toBe(true);
    expect(matchesGlob('templates/a/x.md', 'templates/**/x.md')).toBe(true);
    expect(matchesGlob('templates/a/b/x.md', 'templates/**/x.md')).toBe(true);
    expect(matchesGlob('other/x.md', 'templates/**/x.md')).toBe(false);
  });

  // 6. 旧规则 *.tmp 仍匹配文件后缀
  it('*.tmp matches foo.tmp but not foo.tmp.bak', () => {
    expect(matchesGlob('foo.tmp', '*.tmp')).toBe(true);
    expect(matchesGlob('a/b/foo.tmp', '*.tmp')).toBe(true);
    expect(matchesGlob('foo.tmp.bak', '*.tmp')).toBe(false);
  });

  // 7. 旧规则 prefix* 仍匹配前缀
  it('prefix* matches prefix/x.md and prefix.md', () => {
    expect(matchesGlob('prefix/x.md', 'prefix*')).toBe(true);
    expect(matchesGlob('prefix.md', 'prefix*')).toBe(true);
    expect(matchesGlob('other/x.md', 'prefix*')).toBe(false);
  });

  // 8. 精确路径匹配
  it('exact pattern matches only exact path', () => {
    expect(matchesGlob('foo.md', 'foo.md')).toBe(true);
    expect(matchesGlob('a/foo.md', 'foo.md')).toBe(false);
  });

  // 9. 单 * 不跨 /
  it('a/*.md matches a/x.md but not a/b/x.md', () => {
    expect(matchesGlob('a/x.md', 'a/*.md')).toBe(true);
    expect(matchesGlob('a/b/x.md', 'a/*.md')).toBe(false);
  });

  // 10. **/_*.md 匹配嵌套路径下的下划线开头文件(globstar 中间形态)
  it('**/_*.md matches nested underscore-prefixed files', () => {
    expect(matchesGlob('a/b/_y.md', '**/_*.md')).toBe(true);
    expect(matchesGlob('a/_x.md', '**/_*.md')).toBe(true);
    expect(matchesGlob('a/y.md', '**/_*.md')).toBe(false);
  });

  // 11. regex 元字符 escape 防御
  it('escapes regex metacharacters in literal segments', () => {
    expect(matchesGlob('a.b/c.md', 'a.b/*.md')).toBe(true);
    // a.b 的 . 不能当 regex 通配:axb/c.md 不应命中 a.b/*.md
    expect(matchesGlob('axb/c.md', 'a.b/*.md')).toBe(false);
  });
});
