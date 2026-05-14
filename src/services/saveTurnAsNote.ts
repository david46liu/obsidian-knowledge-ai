import type { Citation } from 'src/types/chat';

export interface BuildNoteMarkdownInput {
  userQuestion: string;
  assistantContent: string;
  notebookName: string;
  timestamp: Date;
  citations: Citation[];
}

const ILLEGAL_CHARS_RE = /[\\/:*?"<>|]/g;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatTimestampForFilename(t: Date): string {
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${pad2(t.getHours())}-${pad2(t.getMinutes())}-${pad2(t.getSeconds())}`;
}

function formatTimestampForHeader(t: Date): string {
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
}

function stripLeadingTrailingNoise(s: string): string {
  return s.replace(/^[\s.\-]+|[\s.\-]+$/g, '');
}

export function buildNoteFilename(question: string, timestamp: Date): string {
  const ts = formatTimestampForFilename(timestamp);
  let head = question.slice(0, 20);
  head = head.replace(ILLEGAL_CHARS_RE, '-');
  head = stripLeadingTrailingNoise(head);
  return head ? `${head} ${ts}.md` : `${ts}.md`;
}

export function buildNoteMarkdown(input: BuildNoteMarkdownInput): string {
  const { userQuestion, assistantContent, notebookName, timestamp, citations } = input;
  const titleLine = userQuestion.trim() ? userQuestion.trim() : '(无对应问题)';
  const parts: string[] = [];
  parts.push(`# ${titleLine}`);
  parts.push('');
  parts.push(`> ${formatTimestampForHeader(timestamp)} — ${notebookName}`);
  parts.push('');
  parts.push(assistantContent);
  if (citations.length > 0) {
    parts.push('');
    parts.push('---');
    parts.push('');
    parts.push('## 引用');
    const sorted = [...citations].sort((a, b) => a.index - b.index);
    for (const c of sorted) {
      parts.push('');
      const heading = c.headingPath.length > 0 ? c.headingPath.join(' > ') : '(无标题)';
      parts.push(`### [${c.index}] ${heading}`);
      parts.push('');
      parts.push(`源文件: [[${c.filePath}]]`);
      parts.push(`字符偏移: ${c.charStart}–${c.charEnd}`);
      parts.push('');
      parts.push(`> ${c.preview}`);
    }
  }
  parts.push('');
  return parts.join('\n');
}
