import type { LLMClient, ChatOptions, ChatMessage } from 'src/providers/types';
import type { SearchHit } from 'src/types/data';
import type { Reranker } from 'src/retrieval/types';

const SYSTEM_PROMPT = [
  '你是检索相关性评分器。',
  '针对用户问题,判断每段笔记的相关性。',
  '输出 JSON 数组,按相关性降序,给出所有候选的序号(index,即用户消息中 [N] 的 N)和 0-10 评分。',
].join('\n');

const MAX_CONTENT_CHARS = 300;

export class LLMReranker implements Reranker {
  readonly name = 'llm';

  constructor(
    private readonly client: LLMClient,
    private readonly model: string
  ) {}

  async rerank(query: string, candidates: SearchHit[]): Promise<SearchHit[]> {
    if (candidates.length === 0) return [];

    const userLines: string[] = [`问题:${query}`, '候选:'];
    candidates.forEach((c, i) => {
      const truncated = c.chunk.content.length > MAX_CONTENT_CHARS
        ? c.chunk.content.slice(0, MAX_CONTENT_CHARS) + '…'
        : c.chunk.content;
      userLines.push(`[${i + 1}] 标题: ${c.chunk.headingText || '(无)'}`);
      userLines.push(`    内容: ${truncated}`);
    });
    userLines.push('');
    userLines.push('返回严格 JSON:{"rankings":[{"index":N,"score":0-10}, ...]}');

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userLines.join('\n') },
    ];

    const opts: ChatOptions = {
      messages,
      model: this.model,
      maxTokens: Math.max(4000, candidates.length * 200),
    };
    if (this.client.capabilities.supportsJsonMode) {
      opts.responseFormat = 'json_object';
    }

    let raw: string;
    try {
      const res = await this.client.chat(opts);
      raw = res.content;
    } catch {
      return fallback(candidates);
    }

    const parsed = parseRankings(raw);
    if (!parsed) return fallback(candidates);

    return applyRankings(candidates, parsed);
  }
}

function fallback(candidates: SearchHit[]): SearchHit[] {
  return candidates.map((c, i) => ({ ...c, finalRank: i }));
}

function parseRankings(raw: string): Array<{ index: number; score: number }> | null {
  try {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj?.rankings)) return obj.rankings;
  } catch { /* fall through */ }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (Array.isArray(obj?.rankings)) return obj.rankings;
  } catch { /* ignore */ }
  return null;
}

function applyRankings(
  candidates: SearchHit[],
  rankings: Array<{ index: number; score: number }>
): SearchHit[] {
  const seen = new Set<number>();
  const out: SearchHit[] = [];
  for (const r of rankings) {
    const idx = Number(r.index);
    if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) continue;
    if (seen.has(idx - 1)) continue;
    seen.add(idx - 1);
    out.push({
      ...candidates[idx - 1],
      rerankScore: typeof r.score === 'number' ? r.score : 0,
      finalRank: out.length,
    });
  }
  candidates.forEach((c, i) => {
    if (!seen.has(i)) out.push({ ...c, finalRank: out.length });
  });
  return out;
}
