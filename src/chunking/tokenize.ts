// Spec §3.2.6: 唯一 token 估算 — Intl.Segmenter(locale='zh', granularity='word').
// 排除纯空白 segment。作为 chunker 内部稳定近似,不代表模型真实 token。

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

export function segmentWords(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) {
    if (segment.trim().length === 0) continue;
    out.push(segment);
  }
  return out;
}

export function estimateTokens(text: string): number {
  return segmentWords(text).length;
}
