export type BlockKind = 'heading' | 'code' | 'list' | 'table' | 'paragraph';

export interface Block {
  kind: BlockKind;
  text: string;       // 已 trim(首尾空白剥离),对齐 spec §3.2.4 的 "block 内容 trim 后 offset"
  charStart: number;  // 指向 text 首字符在 content 中的 UTF-16 code-unit 偏移
  charEnd: number;    // 指向 text 最后一个字符之后的偏移(exclusive)
}

const ATX_HEADING_RE = /^#{1,6}\s+\S/;
const FENCE_RE = /^(```|~~~)/;
const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+\S/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|\s*$/;

/**
 * 按 spec §3.2.4 把 content 切成 block 数组。
 * 处理顺序:先识别 fenced code,再 heading,再 table(需要分隔行),再 list,其余为 paragraph。
 * 空行作为分隔符。
 */
export function scanBlocks(content: string): Block[] {
  if (content.trim().length === 0) return [];

  const lines = splitLinesWithOffsets(content);
  const blocks: Block[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.text.trim().length === 0) {
      i++;
      continue;
    }

    // Fenced code:首行 ``` 或 ~~~,连续到闭合行
    const fenceStart = line.text.match(FENCE_RE);
    if (fenceStart) {
      const marker = fenceStart[1];
      let j = i + 1;
      while (j < lines.length) {
        if (lines[j].text.match(FENCE_RE)?.[1] === marker) { j++; break; }
        j++;
      }
      pushBlock(blocks, 'code', lines, i, j - 1, content);
      i = j;
      continue;
    }

    // Heading:单行
    if (ATX_HEADING_RE.test(line.text)) {
      pushBlock(blocks, 'heading', lines, i, i, content);
      i++;
      continue;
    }

    // Table:两行起(表头 + 分隔),后续连续行
    if (
      TABLE_ROW_RE.test(line.text) &&
      i + 1 < lines.length &&
      TABLE_SEP_RE.test(lines[i + 1].text)
    ) {
      let j = i + 2;
      while (j < lines.length && TABLE_ROW_RE.test(lines[j].text)) j++;
      pushBlock(blocks, 'table', lines, i, j - 1, content);
      i = j;
      continue;
    }

    // List:连续 list 行,允许内部空行
    if (LIST_RE.test(line.text)) {
      let j = i + 1;
      let lastListLine = i;
      while (j < lines.length) {
        const t = lines[j].text;
        if (t.trim().length === 0) { j++; continue; }
        if (LIST_RE.test(t) || /^\s{2,}\S/.test(t)) {
          lastListLine = j;
          j++;
          continue;
        }
        break;
      }
      pushBlock(blocks, 'list', lines, i, lastListLine, content);
      i = lastListLine + 1;
      continue;
    }

    // Paragraph:直到空行
    let j = i;
    while (j < lines.length && lines[j].text.trim().length > 0) j++;
    pushBlock(blocks, 'paragraph', lines, i, j - 1, content);
    i = j;
  }

  return blocks;
}

interface LineWithOffset {
  text: string;
  start: number;
  end: number;
}

function splitLinesWithOffsets(content: string): LineWithOffset[] {
  const out: LineWithOffset[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      out.push({ text: content.substring(start, i), start, end: i });
      start = i + 1;
    }
  }
  if (start <= content.length) {
    out.push({ text: content.substring(start), start, end: content.length });
  }
  return out;
}

function pushBlock(
  blocks: Block[],
  kind: BlockKind,
  lines: LineWithOffset[],
  startLine: number,
  endLine: number,
  content: string
): void {
  let startOff = lines[startLine].start;
  let endOff = lines[endLine].end;

  const rawFirst = lines[startLine].text;
  const leading = rawFirst.length - rawFirst.trimStart().length;
  startOff += leading;

  const rawLast = lines[endLine].text;
  const trailing = rawLast.length - rawLast.trimEnd().length;
  endOff -= trailing;

  if (endOff <= startOff) return;

  blocks.push({
    kind,
    text: content.substring(startOff, endOff),
    charStart: startOff,
    charEnd: endOff,
  });
}
