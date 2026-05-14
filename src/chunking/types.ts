import type { NotebookIndexConfig } from 'src/types/data';

/** 单次切块所需的配置(从 Notebook.indexConfig 合并全局默认后得到)。 */
export interface ChunkerConfig {
  /** 单 chunk token 上限。见 spec §3.2.5。 */
  maxTokens: number;
  /** Level 3 硬切时的目标 overlap(会被 min(overlap, maxTokens/4) 钳制)。 */
  overlapTokens: number;
}

export const CHUNKING_VERSION = 1;
export const PARSER_VERSION = 2;

export const MAX_CHUNKS_PER_FILE = 10_000;

/** 全局默认配置,对齐 spec §2.1 `NotebookIndexConfig`。 */
export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  maxTokens: 500,
  overlapTokens: 50,
};

/** 从 NotebookIndexConfig(含 candidateK/topK 字段)里抽出切块相关字段。 */
export function toChunkerConfig(
  partial: Partial<NotebookIndexConfig> | undefined
): ChunkerConfig {
  return {
    maxTokens: partial?.maxTokens ?? DEFAULT_CHUNKER_CONFIG.maxTokens,
    overlapTokens: partial?.overlapTokens ?? DEFAULT_CHUNKER_CONFIG.overlapTokens,
  };
}

/**
 * 复合 parser 版本号 — FNV-1a 32 位散列。
 *
 * 把 (PARSER_VERSION, extractorVersion, optsKey) 揉成单个正整数。任一输入变化 →
 * 输出变,HashCacheEntry.parserVersion 不匹配 → 触发 STALE_PARSER。
 *
 * 设计:用 number 而非结构化版本号(如 "2.1.0"),因为 HashCacheEntry.parserVersion
 * 类型已发布为 number,改 string 需要数据迁移;数字 JSONL 体积小、比较快、向后兼容。
 * 碰撞概率对 5-10 个版本号组合接近 0;万一碰撞失败模式是"该 STALE_PARSER 时却
 * UNCHANGED",chunks 仍可读但落后一个版本,用户下次手动 reindex 即可恢复。
 */
export function computeParserVersion(extractorVersion: number, optsKey: string): number {
  const seed = `${PARSER_VERSION}|${extractorVersion}|${optsKey}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // 转无符号 32 位
}
