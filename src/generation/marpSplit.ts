/**
 * Marp 幻灯片分页解析器
 *
 * 把 LLM 输出的 Marp 格式 markdown 切分成单页幻灯片数组。
 *
 * 严格输入约定(见 generators.ts 的 'ppt' systemPrompt):
 *   - 每张幻灯片之间用单独一行的 `---` 分隔
 *   - 不应包含 marp frontmatter(由系统注入),但本解析器仍会防御性跳过开头 frontmatter
 *
 * 切分规则:
 *   - 跳过开头 frontmatter:若首个非空行是 `---`,则跳到下一个 `---` 之后开始解析
 *   - `---` 必须独占一行(允许尾部空白)才视为分隔符;`# 标题 --- 副标题` 之类不会被切
 *   - 切分后每页 trim;过滤完全空的页(末尾空 `---\n` 后的空段不输出)
 */

/** 匹配独占一行的 `---`(允许尾部空白) */
const SEPARATOR_RE = /^---\s*$/;

/**
 * 把 Marp markdown 切分为幻灯片字符串数组。
 *
 * @param markdown LLM 输出的整段 Marp markdown
 * @returns 每张幻灯片的内容(已 trim,不含分隔符);过滤空页
 */
export function splitMarpSlides(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);

  // 跳过开头 frontmatter:若首个非空行是 `---`,定位到匹配的下一个 `---` 之后
  let start = 0;
  let firstNonEmpty = 0;
  while (firstNonEmpty < lines.length && lines[firstNonEmpty].trim().length === 0) {
    firstNonEmpty++;
  }
  if (firstNonEmpty < lines.length && SEPARATOR_RE.test(lines[firstNonEmpty])) {
    // 寻找闭合 `---`
    let close = firstNonEmpty + 1;
    while (close < lines.length && !SEPARATOR_RE.test(lines[close])) {
      close++;
    }
    if (close < lines.length) {
      // 找到闭合,从其下一行开始
      start = close + 1;
    }
    // 若未找到闭合(异常情况),保持 start = 0,把整段当内容处理
  }

  // 按独占一行的 `---` 切分
  const slides: string[] = [];
  let buffer: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (SEPARATOR_RE.test(lines[i])) {
      const page = buffer.join('\n').trim();
      if (page.length > 0) {
        slides.push(page);
      }
      buffer = [];
    } else {
      buffer.push(lines[i]);
    }
  }
  // 末尾残留 buffer
  const tail = buffer.join('\n').trim();
  if (tail.length > 0) {
    slides.push(tail);
  }

  return slides;
}
