import type { Chunk, ChunkKind, Locator, SourceId } from 'src/types/data';
import { scanHeadings, buildHeadingPath } from 'src/chunking/headings';
import { scanBlocks, type Block } from 'src/chunking/markdownBlocks';
import { splitSectionByBlocks } from 'src/chunking/splitters';
import { estimateTokens } from 'src/chunking/tokenize';
import { MAX_CHUNKS_PER_FILE, type ChunkerConfig } from 'src/chunking/types';
import { computeHash } from 'src/utils/hash';
import type { LocatorMapEntry } from 'src/extraction/types';

export interface ChunkFileInput {
  filePath: string;
  sourceId: SourceId;
  fileHash: string;
  config: ChunkerConfig;
  locatorMap?: LocatorMapEntry[];
}

export async function chunkFile(
  content: string,
  input: ChunkFileInput
): Promise<Chunk[]> {
  if (content.trim().length === 0) return [];

  const blocks = scanBlocks(content);
  if (blocks.length === 0) return [];

  const headings = scanHeadings(content);

  const sections = groupBlocksBySection(blocks, headings);

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const raw = splitSectionByBlocks(section.blocks, content, input.config);
    for (const r of raw) {
      if (chunkIndex >= MAX_CHUNKS_PER_FILE) break;
      const trimmed = r.text.trim();
      if (trimmed.length === 0) continue;
      const contentHash = await computeHash(new TextEncoder().encode(trimmed));
      chunks.push({
        id: `${input.fileHash}:${chunkIndex}`,
        chunkIndex,
        fileHash: input.fileHash,
        filePath: input.filePath,
        sourceId: input.sourceId,
        headingPath: section.headingPath,
        headingText: section.headingPath.join(' > '),
        content: trimmed,
        contentHash,
        tokenCount: estimateTokens(trimmed),
        charStart: r.charStart,
        charEnd: r.charEnd,
        kind: deriveKind(r.blockKinds),
        locator: input.locatorMap ? findLocator(r.charStart, input.locatorMap) : undefined,
      });
      chunkIndex++;
    }
    if (chunkIndex >= MAX_CHUNKS_PER_FILE) break;
  }

  return chunks;
}

interface Section {
  headingPath: string[];
  blocks: Block[];
}

function groupBlocksBySection(
  blocks: Block[],
  headings: ReturnType<typeof scanHeadings>
): Section[] {
  if (headings.length === 0) {
    return [{ headingPath: [], blocks }];
  }

  const sections: Section[] = [];
  let currentStack: { level: number; text: string }[] = [];
  let currentBlocks: Block[] = [];
  let currentPath: string[] = [];
  let headingIdx = 0;

  for (const b of blocks) {
    const headingOnThisBlock =
      b.kind === 'heading' && headingIdx < headings.length && headings[headingIdx].charStart === b.charStart;

    if (headingOnThisBlock) {
      if (currentBlocks.length > 0) {
        sections.push({ headingPath: [...currentPath], blocks: currentBlocks });
        currentBlocks = [];
      }
      const h = headings[headingIdx++];
      currentPath = buildHeadingPath(currentStack, { level: h.level, text: h.text });
      // 同步更新 currentStack(buildHeadingPath 纯函数,不 mutate)
      while (currentStack.length > 0 && currentStack[currentStack.length - 1].level >= h.level) {
        currentStack.pop();
      }
      currentStack.push({ level: h.level, text: h.text });
      currentBlocks.push(b);
    } else {
      currentBlocks.push(b);
    }
  }
  if (currentBlocks.length > 0) {
    sections.push({ headingPath: [...currentPath], blocks: currentBlocks });
  }
  return sections;
}

function deriveKind(blockKinds: Set<Block['kind']>): ChunkKind {
  // spec §3.2.8: heading 本身视为 paragraph;与普通段落合并不引起 mixed。
  const effective = new Set<ChunkKind>();
  for (const k of blockKinds) {
    effective.add(k === 'heading' ? 'paragraph' : (k as ChunkKind));
  }
  if (effective.size === 1) return [...effective][0];
  return 'mixed';
}

function findLocator(charStart: number, map: LocatorMapEntry[]): Locator | undefined {
  // 二分:找最后一个 charStart <= charStart 的 entry
  let lo = 0, hi = map.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid].charStart <= charStart) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return undefined;
  const entry = map[found];
  return charStart < entry.charEnd ? entry.locator : undefined;
}
