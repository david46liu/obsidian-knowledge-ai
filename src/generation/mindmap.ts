/**
 * 思维导图解析器
 *
 * 把 LLM 输出的 markdown 大纲解析为节点树。
 *
 * 严格输入约定(见 generators.ts 的 'mind-map' systemPrompt):
 *   - 第一行无缩进,单一 root
 *   - 每深一级缩进 2 个空格
 *   - 每行格式:`- 节点文本 [N]?[N]?...`(末尾引用编号 0 或多个)
 *
 * 容错策略:
 *   - 缩进非 2 倍数 → 累积 errors,跳过该行
 *   - 多个 root(第二行也无缩进) → 第二个 root 当成第一个 root 的子节点 + warning
 *   - 孤儿节点(缩进跳级) → errors,跳过
 *   - 空行 / 不匹配 LINE_RE 的非空行 → errors(非空时),非致命
 */

/** 思维导图的单个节点 */
export interface MindNode {
  /** 全树自增序号字符串('0' / '1' / '2' / ...),解析时分配 */
  id: string;
  /** 节点文本(已剥离尾部引用) */
  text: string;
  /** 尾部引用编号([N][N]... 中提取的 N 列表,顺序与原文一致) */
  citationIndices: number[];
  /** 子节点 */
  children: MindNode[];
}

/** 解析结果 */
export interface ParseResult {
  /** 根节点;输入完全无法解析时为 null */
  root: MindNode | null;
  /** 解析过程中累积的容错信息(非致命) */
  errors: string[];
}

/** 匹配单行:可选缩进 + `- ` + 内容 */
const LINE_RE = /^( *)- +(.+?)\s*$/;

/** 匹配尾部连续引用 [N][N]...,允许块前后空白 */
const TRAILING_CITATIONS_RE = /(?:\s*\[(\d+)\])+\s*$/;

/** 单个 [N] 抽取(对 TRAILING_CITATIONS_RE 切下来的子串再拆) */
const SINGLE_CITATION_RE = /\[(\d+)\]/g;

/**
 * 从节点原始文本中切出 text 与 citationIndices。
 * 仅处理"尾部连续 [N]";文本中间的 [5] 不视为引用。
 */
function extractCitations(raw: string): { text: string; citationIndices: number[] } {
  const match = raw.match(TRAILING_CITATIONS_RE);
  if (!match) {
    return { text: raw.trim(), citationIndices: [] };
  }
  const tail = match[0];
  const text = raw.slice(0, raw.length - tail.length).trim();
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  // 重置 lastIndex(全局正则)
  SINGLE_CITATION_RE.lastIndex = 0;
  while ((m = SINGLE_CITATION_RE.exec(tail)) !== null) {
    indices.push(Number(m[1]));
  }
  return { text, citationIndices: indices };
}

/**
 * 解析 markdown 大纲为思维导图树。
 *
 * @param markdown LLM 输出的整段大纲文本
 */
export function parseMindMap(markdown: string): ParseResult {
  const errors: string[] = [];
  const lines = markdown.split(/\r?\n/);

  let root: MindNode | null = null;
  /** 栈:索引 = depth,值 = 该 depth 上"当前最近"的节点 */
  const stack: MindNode[] = [];
  let nextId = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.trim().length === 0) {
      // 空行:静默忽略(不计入 errors,避免噪音)
      continue;
    }

    const m = rawLine.match(LINE_RE);
    if (!m) {
      errors.push(`line ${i + 1}: skipped non-list text "${rawLine.trim()}"`);
      continue;
    }

    const indent = m[1].length;
    if (indent % 2 !== 0) {
      errors.push(`line ${i + 1}: indent ${indent} is not a multiple of 2, skipped`);
      continue;
    }
    const depth = indent / 2;

    const { text, citationIndices } = extractCitations(m[2]);
    const node: MindNode = {
      id: String(nextId++),
      text,
      citationIndices,
      children: [],
    };

    if (depth === 0) {
      if (root === null) {
        root = node;
        stack.length = 0;
        stack[0] = node;
      } else {
        // 多 root:挂到第一个 root 下作为子节点
        errors.push(`line ${i + 1}: extra root "${text}" attached as child of first root`);
        root.children.push(node);
        // 维护栈:此节点位于 depth=1
        stack.length = 1;
        stack[1] = node;
      }
      continue;
    }

    // depth >= 1
    if (root === null) {
      errors.push(`line ${i + 1}: orphan node "${text}" before any root, skipped`);
      continue;
    }
    const parent = stack[depth - 1];
    if (!parent) {
      errors.push(`line ${i + 1}: orphan node "${text}" at depth ${depth} (no parent at depth ${depth - 1}), skipped`);
      continue;
    }
    parent.children.push(node);
    // 截断深于 depth 的栈分支,然后写入当前 depth
    stack.length = depth + 1;
    stack[depth] = node;
  }

  return { root, errors };
}
