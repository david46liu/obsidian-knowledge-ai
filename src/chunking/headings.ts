/** 一个被识别的 ATX heading(spec §3.2.3)。 */
export interface HeadingHit {
  line: number;        // 0-based 行号
  level: number;       // 1-6
  text: string;        // 去掉 #、尾 #、两端空白后的纯文本
  charStart: number;   // 行首在原文中的 UTF-16 code-unit 偏移
  charEnd: number;     // 行尾(不含换行)在原文中的偏移
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^(```|~~~)/;

/** 行级扫描 heading。fenced code block 内的 # 行不算。 */
export function scanHeadings(content: string): HeadingHit[] {
  const hits: HeadingHit[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;

  let offset = 0;
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLen = line.length;

    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (fenceMarker === marker) {
        inFence = false;
        fenceMarker = null;
      }
    }

    if (!inFence) {
      const m = line.match(HEADING_RE);
      if (m) {
        hits.push({
          line: i,
          level: m[1].length,
          text: m[2].trim().replace(/\s*#*\s*$/, ''),
          charStart: offset,
          charEnd: offset + lineLen,
        });
      }
    }

    offset += lineLen + 1; // +1 for the '\n' removed by split
  }

  return hits;
}

/**
 * 栈式构造 headingPath。**纯函数**:不修改输入的 currentStack,返回全新的 path 文本数组。
 * 规则:
 *   1) 弹出所有 level ≥ new.level 的栈顶
 *   2) 压入新 heading
 *
 * 调用方必须自己维护 HeadingStackItem[] 状态(因为 buildHeadingPath 只返回 path text),
 * 例如 `groupBlocksBySection` 在调用本函数后,再自行 pop/push currentStack。若本函数内部
 * mutate caller 的数组,就会与 caller 的 pop/push 双重作用,产生 nested heading path 错位。
 */
export interface HeadingStackItem {
  level: number;
  text: string;
}

export function buildHeadingPath(
  currentStack: HeadingStackItem[] | string[],
  heading: { level: number; text: string }
): string[] {
  // 关键:克隆输入,避免 mutate caller
  const cloned: HeadingStackItem[] =
    currentStack.length === 0
      ? []
      : typeof currentStack[0] === 'string'
      ? (currentStack as string[]).map((text, i) => ({ level: i + 1, text }))
      : (currentStack as HeadingStackItem[]).map(x => ({ level: x.level, text: x.text }));

  while (cloned.length > 0 && cloned[cloned.length - 1].level >= heading.level) {
    cloned.pop();
  }
  cloned.push({ level: heading.level, text: heading.text });
  return cloned.map(s => s.text);
}
