import type { Locator } from 'src/types/data';

export interface LocatorMapEntry {
  /** markdown 中区间的字符起点(包含) */
  charStart: number;
  /** markdown 中区间的字符终点(不包含) */
  charEnd: number;
  locator: Locator;
}

export interface ExtractionResult {
  /** 拼好的 markdown 文本,送入 chunkFile */
  markdown: string;
  /**
   * locator 区间表 — 按 charStart 升序、互不重叠。
   * chunker 用 chunk.charStart 二分查找命中区间,把 locator 浅拷贝到 chunk。
   */
  locatorMap: LocatorMapEntry[];
}

export interface Extractor {
  /** 此 extractor 处理的扩展名集合(小写、不含点) */
  readonly extensions: readonly string[];
  /** 解析逻辑版本;升级 extractor 时 +1 → 触发该 extractor 处理过的文件 STALE_PARSER */
  readonly version: number;
  /** opts 用于 extractor 行为开关(如 pptx includeNotes) */
  extract(buffer: ArrayBuffer, opts?: Record<string, unknown>): Promise<ExtractionResult>;
}
