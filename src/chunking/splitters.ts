import type { Block } from 'src/chunking/markdownBlocks';
import { estimateTokens, segmentWords } from 'src/chunking/tokenize';
import type { ChunkerConfig } from 'src/chunking/types';

export interface RawChunk {
  text: string;
  charStart: number;
  charEnd: number;
  /** 构成本 chunk 的 block kind 集合(用于上层决定 ChunkKind)。 */
  blockKinds: Set<Block['kind']>;
}

/**
 * Level 1 主入口:以给定的 block 序列(对应 spec 中的一个 section)为输入,
 * 返回一组 RawChunk。Level 2/3 在单个 block 超 maxTokens 时触发。
 */
export function splitSectionByBlocks(
  blocks: Block[],
  source: string,
  config: ChunkerConfig
): RawChunk[] {
  const out: RawChunk[] = [];
  let buf: Block[] = [];
  let bufTokens = 0;

  const flush = () => {
    if (buf.length === 0) return;
    out.push(mergeBlocks(buf, source));
    buf = [];
    bufTokens = 0;
  };

  for (const b of blocks) {
    const tk = estimateTokens(b.text);
    if (tk <= config.maxTokens) {
      if (bufTokens + tk <= config.maxTokens) {
        buf.push(b);
        bufTokens += tk;
      } else {
        flush();
        buf = [b];
        bufTokens = tk;
      }
    } else {
      flush();
      const sub = splitOversizedBlock(b, source, config);
      out.push(...sub);
    }
  }
  flush();
  return out;
}

function mergeBlocks(buf: Block[], source: string): RawChunk {
  const first = buf[0];
  const last = buf[buf.length - 1];
  return {
    text: source.substring(first.charStart, last.charEnd),
    charStart: first.charStart,
    charEnd: last.charEnd,
    blockKinds: new Set(buf.map(b => b.kind)),
  };
}

/** Level 2:按句子切。若单句仍超限,交给 Level 3。 */
function splitOversizedBlock(block: Block, source: string, config: ChunkerConfig): RawChunk[] {
  const sentences = segmentSentences(block.text, block.charStart);

  const out: RawChunk[] = [];
  let bufSents: typeof sentences = [];
  let bufTokens = 0;

  const flushBuf = () => {
    if (bufSents.length === 0) return;
    const first = bufSents[0];
    const last = bufSents[bufSents.length - 1];
    out.push({
      text: source.substring(first.charStart, last.charEnd),
      charStart: first.charStart,
      charEnd: last.charEnd,
      blockKinds: new Set([block.kind]),
    });
    // overlap:保留最后 1 个句子作为下个 chunk 的开头
    bufSents = [last];
    bufTokens = estimateTokens(last.text);
  };

  for (const s of sentences) {
    const tk = estimateTokens(s.text);
    if (tk > config.maxTokens) {
      if (bufSents.length > 0) {
        const first = bufSents[0];
        const last = bufSents[bufSents.length - 1];
        out.push({
          text: source.substring(first.charStart, last.charEnd),
          charStart: first.charStart,
          charEnd: last.charEnd,
          blockKinds: new Set([block.kind]),
        });
        bufSents = [];
        bufTokens = 0;
      }
      out.push(...splitOversizedSentence(s.text, s.charStart, block.kind, config));
      continue;
    }

    if (bufTokens + tk <= config.maxTokens) {
      bufSents.push(s);
      bufTokens += tk;
    } else {
      flushBuf();
      bufSents.push(s);
      bufTokens += tk;
    }
  }

  if (bufSents.length > 0) {
    const first = bufSents[0];
    const last = bufSents[bufSents.length - 1];
    out.push({
      text: source.substring(first.charStart, last.charEnd),
      charStart: first.charStart,
      charEnd: last.charEnd,
      blockKinds: new Set([block.kind]),
    });
  }
  return out;
}

interface Sentence { text: string; charStart: number; charEnd: number; }

/** 按 /[。.?？!!\n]+/ 切句子,保留分隔符与之前句子同属一块。 */
function segmentSentences(text: string, baseOffset: number): Sentence[] {
  const out: Sentence[] = [];
  const re = /[。.?？!!\n]+/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const endWithSep = m.index + m[0].length;
    const slice = text.substring(lastEnd, endWithSep);
    if (slice.trim().length > 0) {
      out.push({
        text: slice,
        charStart: baseOffset + lastEnd,
        charEnd: baseOffset + endWithSep,
      });
    }
    lastEnd = endWithSep;
  }
  if (lastEnd < text.length) {
    const slice = text.substring(lastEnd);
    if (slice.trim().length > 0) {
      out.push({
        text: slice,
        charStart: baseOffset + lastEnd,
        charEnd: baseOffset + text.length,
      });
    }
  }
  return out;
}

/** Level 3:超长单句硬切 segment。overlap 计入预算。 */
function splitOversizedSentence(
  text: string,
  baseOffset: number,
  kind: Block['kind'],
  config: ChunkerConfig
): RawChunk[] {
  const effectiveOverlap = Math.min(config.overlapTokens, Math.floor(config.maxTokens / 4));
  const segs = segmentWords(text);

  // segments 自身不带原文 offset,需要重建:我们对每个 segment 在 text 中顺序定位。
  const segOffsets: Array<{ seg: string; start: number; end: number }> = [];
  let cursor = 0;
  for (const seg of segs) {
    const idx = text.indexOf(seg, cursor);
    if (idx < 0) continue;
    segOffsets.push({ seg, start: idx, end: idx + seg.length });
    cursor = idx + seg.length;
  }

  const out: RawChunk[] = [];
  let i = 0;
  while (i < segOffsets.length) {
    const take = config.maxTokens;
    const endExclusive = Math.min(i + take, segOffsets.length);
    const first = segOffsets[i];
    const last = segOffsets[endExclusive - 1];
    out.push({
      text: text.substring(first.start, last.end),
      charStart: baseOffset + first.start,
      charEnd: baseOffset + last.end,
      blockKinds: new Set([kind]),
    });
    if (endExclusive >= segOffsets.length) break;
    // 下一个 chunk 从 endExclusive - effectiveOverlap 开始
    i = Math.max(endExclusive - effectiveOverlap, i + 1);
  }
  return out;
}
