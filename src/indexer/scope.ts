import type { Notebook, Source } from 'src/types/data';

/**
 * Phase 1 的 glob 升级:
 * - 旧规则保留:精确 / `prefix*`(仅末尾单 *) / `*suffix`(仅开头单 *)
 * - 新增 globstar:含 `**` 时转 regex
 *   - `**` -> `.*`(跨 / )
 *   - `*`  -> `[^/]*`(不跨 / )
 *   - `/**` 在中间允许零或多段(/ 可选),令 `templates/**\/x.md` 也匹配 `templates/x.md`
 *   - 其他 regex 元字符 escape
 */
export function matchesGlob(path: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern === path) return true;
  if (!pattern.includes('**')) {
    if (pattern.startsWith('*') && pattern.length > 1 && !pattern.includes('*', 1)) {
      return path.endsWith(pattern.slice(1));
    }
    if (pattern.endsWith('*') && pattern.length > 1 && !pattern.slice(0, -1).includes('*')) {
      return path.startsWith(pattern.slice(0, -1));
    }
  }
  if (pattern.includes('*')) {
    return globToRegex(pattern).test(path);
  }
  return false;
}

function globToRegex(pattern: string): RegExp {
  // NUL placeholder: 不会与路径或 regex 元字符冲突, 避免 ** 被单 * 规则吃掉
  const STARSTAR = '\x00';
  let s = pattern.replace(/\*\*/g, STARSTAR);
  // escape regex specials (不含 * 和 NUL,留给后续替换)
  s = s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // 单 * -> [^/]* (不跨段)
  s = s.replace(/\*/g, '[^/]*');
  // /\x00/ (中间的 /**\/ ) -> 允许零或多段, / 可选
  s = s.replace(/\/\x00\//g, '/(?:.*/)?');
  // 其余 \x00 (开头/末尾的 ** 或单独 **) -> .*
  s = s.replace(/\x00/g, '.*');
  return new RegExp(`^${s}$`);
}

const DEFAULT_EXCLUDES = ['*.tmp', '.*'];

/** 判断 path 是否属于 Source 的作用域。完整处理 recursive/includeGlobs/excludeGlobs/enabled。 */
export function matchesSource(path: string, source: Source): boolean {
  if (source.enabled === false) return false;
  if (source.type !== 'folder') return false;

  const base = source.path.endsWith('/') ? source.path.slice(0, -1) : source.path;
  if (base !== '' && path !== base && !path.startsWith(base + '/')) return false;

  if (source.recursive === false) {
    const rest = (path === base || base === '') ? path : path.slice(base.length + 1);
    if (rest.includes('/')) return false;
  }

  if (source.includeGlobs && source.includeGlobs.length > 0) {
    const hit = source.includeGlobs.some(g => matchesGlob(path, g));
    if (!hit) return false;
  }

  const excludes = source.excludeGlobs ?? DEFAULT_EXCLUDES;
  for (const ex of excludes) {
    if (matchesGlob(path, ex)) return false;
    // 特殊:'.*' 匹配路径中任一段以 . 开头的隐藏目录/文件
    if (ex === '.*' && path.split('/').some(seg => seg.startsWith('.'))) return false;
  }

  return true;
}

export function matchesNotebookScope(path: string, notebook: Pick<Notebook, 'sources'>): boolean {
  return notebook.sources.some(s => matchesSource(path, s));
}

export function resolveSourceId(path: string, notebook: Pick<Notebook, 'sources'>): string | undefined {
  for (const s of notebook.sources) {
    if (matchesSource(path, s)) return s.id;
  }
  return undefined;
}
