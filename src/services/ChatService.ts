import type { NotebookId, SearchHit, Chunk } from 'src/types/data';
import type { ChatStreamEvent, ChatTurn, Citation, AskOptions } from 'src/types/chat';
import type { SearchService } from './SearchService';
import type { SummaryService } from './SummaryService';
import type { HashCacheStore } from 'src/indexer/hashCache';
import type { Clock } from 'src/infra/clock';
import type { Logger } from 'src/infra/logger';
import type { ChatMessage, LLMClient } from 'src/providers/types';

// Modern long-context models (GPT-4o/Claude/Qwen2.5/DeepSeek-V3) all have
// 32k–128k input windows. 12k was a leftover from older models and capped
// the assistant to ~24 chunks of context; with topK=15 and chunk_max=500 we
// were not even close to filling the budget. 32k lets us comfortably fit
// topK=15 chunks plus history without truncation.
const MAX_CONTEXT_TOKENS = 32000;
const DEFAULT_TOP_K = 15;
const ASSISTANT_MAX_TOKENS = 4096;
const DEFAULT_EXPAND_NEIGHBORS = 1;
const QUERY_EXPANSION_MAX = 3;
const QUERY_EXPANSION_MAX_TOKENS = 200;
const QUERY_EXPANSION_TIMEOUT_MS = 8000;
const RRF_K = 60;

// Summary-mode tuning. When the user asks a "sum up the whole notebook" style
// question, plain top-K retrieval over-concentrates on one or two documents.
// We widen the candidate pool, then keep at most SUMMARY_PER_DOC chunks per
// document and cap the document count, so the LLM sees breadth instead of depth.
const SUMMARY_SEARCH_K = 50;
const SUMMARY_PER_DOC = 1;
const SUMMARY_DOC_LIMIT = 25;
const SUMMARY_KEYWORDS = /总结|汇总|盘点|概览|全貌|罗列|列出|亮点|要点|重点|有哪些|有什么|有几个|都做了|做了什么|进展如何|整体情况/;

const QUERY_EXPANSION_SYSTEM_PROMPT = [
  '你是一个检索查询改写助手。',
  '把用户的问题改写成 2-3 个不同角度的检索查询，覆盖同义词、子主题、相关概念。',
  '严格输出 JSON 数组，例如：["改写1","改写2","改写3"]。',
  '不要解释，不要 markdown 代码块，不要其他任何字符。',
].join('\n');

const DEFAULT_SYSTEM_PROMPT = [
  '你是基于用户笔记的智能助手。',
  '请仅根据下方提供的资料回答问题,并在引用资料时使用 [N] 编号。',
  '若资料中未涉及问题,明确告知"资料中未提及",不要编造。',
].join('\n');

export interface ResolvedTaskClient {
  client: LLMClient;
  model: string;
}

export interface ChatServiceDeps {
  searchService: SearchService;
  resolveTaskClient: () => ResolvedTaskClient | null;
  /** 读取 notebook 的 systemPrompt;返回 null 用默认 */
  getNotebookSystemPrompt: (id: NotebookId) => Promise<string | null>;
  /** 相邻 chunk 扩展用 — 读取每个文档的全部 chunks。缺省时 expandNeighbors 自动失效。 */
  hashCache?: HashCacheStore;
  /** summaryMode 触发时优先用文档级摘要召回候选文档(若可用 + 已生成 summary)。 */
  summaryService?: SummaryService;
  clock: Clock;
  logger?: Logger;
}

export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  async *ask(
    notebookId: NotebookId,
    history: ChatTurn[],
    userText: string,
    opts: AskOptions = {}
  ): AsyncIterable<ChatStreamEvent> {
    // expandQuery / expandNeighbors / summaryMode default to OFF here so that
    // existing call sites and tests keep their original (single-query,
    // no-neighbor, chunk-mode) behaviour. The UI (ChatView) opts in for users.
    const {
      rerank = true,
      topK = DEFAULT_TOP_K,
      signal,
      expandQuery = false,
      expandNeighbors = 0,
      summaryMode = 'off',
    } = opts;
    const isSummary = summaryMode === 'on'
      || (summaryMode === 'auto' && this.isSummaryQuestion(userText));
    const effectiveTopK = isSummary ? SUMMARY_SEARCH_K : topK;
    const turnId = crypto.randomUUID();
    let accContent = '';
    let citations: Citation[] = [];

    try {
      yield { type: 'retrieving' };
      if (rerank) yield { type: 'reranking' };

      // 1a. SummaryMode 优先路径:如果摘要服务可用且至少有 5 个文档已生成 summary,
      //     用摘要 BM25 直接召回最相关的文档列表 — 比"chunk 检索后按 doc 分组"更代表
      //     文档主题,对"亮点/总结/有哪些"这类全局问题质量明显更高。
      //     若摘要覆盖不足或检索失败,自动回退到下方的 chunk-level 检索。
      let summaryHits: SearchHit[] | null = null;
      if (isSummary && this.deps.summaryService && this.deps.hashCache) {
        try {
          const docHashes = await this.deps.summaryService.searchTopDocuments(
            notebookId, userText, SUMMARY_DOC_LIMIT,
          );
          if (docHashes.length >= 5) {
            summaryHits = this.hitsFromDocHashes(docHashes);
          }
        } catch (e) {
          this.deps.logger?.warn(
            `summary retrieval failed, falling back to chunk search: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }

      let breadthMerged: SearchHit[];
      if (summaryHits) {
        // P2.7 — 走摘要路径:直接拿到文档列表,跳过 expandQuery 和 RRF。
        // expandNeighbors 会在后面统一处理。
        breadthMerged = summaryHits;
      } else {
        // 1b. Optional: expand the user query into multiple search angles via LLM.
        let queries = [userText];
        if (expandQuery) {
          const resolved = this.deps.resolveTaskClient();
          if (resolved) {
            const extra = await this.expandQuery(userText, resolved, signal);
            if (extra.length > 0) queries = [userText, ...extra];
          }
        }

        // 2. Run all queries in parallel, then RRF-merge across queries.
        const perQuery = await Promise.all(
          queries.map(q => this.deps.searchService.search(notebookId, q, {
            rerank, topK: effectiveTopK,
          }))
        );
        const mergedLimit = isSummary
          ? SUMMARY_SEARCH_K
          : Math.max(effectiveTopK, Math.ceil(effectiveTopK * 1.5));
        const merged = perQuery.length === 1
          ? perQuery[0]
          : this.rrfMergeAcrossQueries(perQuery, mergedLimit);

        // 3a. Summary mode (无摘要 fallback): collapse to «top-1 chunk per document»
        breadthMerged = isSummary
          ? this.groupByDocument(merged, SUMMARY_PER_DOC, SUMMARY_DOC_LIMIT)
          : merged;
      }

      // 3b. Optional: expand each hit with its neighbors from the same document.
      const hits = (expandNeighbors > 0 && this.deps.hashCache)
        ? this.expandWithNeighbors(breadthMerged, expandNeighbors)
        : breadthMerged;

      citations = this.buildCitations(hits);
      yield { type: 'citations', citations };

      const rawPrompt = await this.deps.getNotebookSystemPrompt(notebookId);
      const systemPrompt = (rawPrompt && rawPrompt.trim()) || DEFAULT_SYSTEM_PROMPT;
      const messages = this.buildMessages(systemPrompt, citations, hits, history, userText);

      const resolved = this.deps.resolveTaskClient();
      if (!resolved) {
        yield { type: 'error', error: '未配置 chat 任务的模型;请到设置页指派' };
        return;
      }

      yield { type: 'generating' };

      const stream = resolved.client.chatStream({
        messages,
        model: resolved.model,
        maxTokens: ASSISTANT_MAX_TOKENS,
        signal,
      });

      for await (const ev of stream) {
        if (signal?.aborted) {
          const turn: ChatTurn = {
            id: turnId, role: 'assistant', content: accContent, citations,
            createdAt: this.deps.clock.now(), cancelled: true,
          };
          yield { type: 'done', turn };
          return;
        }
        if (ev.type === 'delta' && ev.content) {
          accContent += ev.content;
          yield { type: 'token', content: ev.content };
        }
      }

      const turn: ChatTurn = {
        id: turnId, role: 'assistant', content: accContent, citations,
        createdAt: this.deps.clock.now(),
      };
      yield { type: 'done', turn };

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.deps.logger?.warn(`ChatService.ask failed: ${msg}`);
      yield { type: 'error', error: msg };
    }
  }

  private buildCitations(hits: SearchHit[]): Citation[] {
    return hits.map((h, i) => ({
      index: i + 1,
      chunkId: h.chunk.id,
      filePath: h.chunk.filePath,
      headingPath: h.chunk.headingPath,
      charStart: h.chunk.charStart,
      charEnd: h.chunk.charEnd,
      preview: h.chunk.content.slice(0, 200),
    }));
  }

  /** 关键词启发式 — 检测「总结/汇总/亮点/有哪些」等需要广覆盖的问题。 */
  private isSummaryQuestion(text: string): boolean {
    return SUMMARY_KEYWORDS.test(text);
  }

  /**
   * 把 SummaryService 召回的 fileHash 列表转成 SearchHit[]。
   * 每个文档取第一个 chunk(通常含标题/前言),作为后续 expandNeighbors 的锚点。
   */
  private hitsFromDocHashes(docHashes: string[]): SearchHit[] {
    if (!this.deps.hashCache) return [];
    const out: SearchHit[] = [];
    for (const hash of docHashes) {
      const entry = this.deps.hashCache.get(hash);
      if (!entry || entry.status !== 'ok' || entry.chunks.length === 0) continue;
      out.push({
        chunk: entry.chunks[0],
        finalRank: out.length,
      });
    }
    return out;
  }

  /**
   * 把 hits 按 fileHash 分组,每文档保留前 perDoc 个 chunk,最多 maxDocs 个文档。
   * 输入 hits 应已按相关度排序;分组保持首次出现顺序(即文档相关度顺序)。
   */
  private groupByDocument(hits: SearchHit[], perDoc: number, maxDocs: number): SearchHit[] {
    const docMap = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const arr = docMap.get(h.chunk.fileHash);
      if (arr) {
        if (arr.length < perDoc) arr.push(h);
      } else {
        if (docMap.size >= maxDocs) continue;
        docMap.set(h.chunk.fileHash, [h]);
      }
    }
    const out: SearchHit[] = [];
    for (const list of docMap.values()) out.push(...list);
    return out.map((h, i) => ({ ...h, finalRank: i }));
  }

  /**
   * 调用 LLM 把用户问题改写成多个不同角度的检索查询。
   * 任何失败（解析、超时、abort）都被吞掉并返回 []，由调用方回退到原查询。
   */
  private async expandQuery(
    userText: string,
    resolved: ResolvedTaskClient,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const expansionSignal = AbortSignal.any([
      AbortSignal.timeout(QUERY_EXPANSION_TIMEOUT_MS),
      ...(signal ? [signal] : []),
    ]);
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: QUERY_EXPANSION_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ];
      let acc = '';
      const stream = resolved.client.chatStream({
        messages,
        model: resolved.model,
        maxTokens: QUERY_EXPANSION_MAX_TOKENS,
        signal: expansionSignal,
      });
      for await (const ev of stream) {
        if (ev.type === 'delta' && ev.content) acc += ev.content;
      }
      const match = acc.match(/\[[\s\S]*\]/);
      if (!match) return [];
      const parsed: unknown = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map(s => s.trim())
        .filter(s => s !== userText)
        .slice(0, QUERY_EXPANSION_MAX);
    } catch (e) {
      this.deps.logger?.warn(`query expansion failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  /**
   * 多查询结果用 Reciprocal Rank Fusion 合并。每个 chunk 在每个查询里的名次
   * 都贡献 1/(K+rank) 分。优势：被多个查询都召回的 chunk 自然排前。
   */
  private rrfMergeAcrossQueries(perQuery: SearchHit[][], limit: number): SearchHit[] {
    const acc = new Map<string, { hit: SearchHit; score: number }>();
    for (const hits of perQuery) {
      hits.forEach((h, rank) => {
        const id = h.chunk.id;
        const inc = 1 / (RRF_K + rank + 1);
        const cur = acc.get(id);
        if (cur) {
          cur.score += inc;
        } else {
          acc.set(id, { hit: h, score: inc });
        }
      });
    }
    return [...acc.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((m, i) => ({ ...m.hit, finalRank: i }));
  }

  /**
   * 把每个 hit 的同文档前后 N 个 chunks 也加进来，按文档内顺序紧贴原 hit。
   * 去重：同一个 chunk id 不会出现两次。
   */
  private expandWithNeighbors(hits: SearchHit[], count: number): SearchHit[] {
    const out: SearchHit[] = [];
    const seen = new Set<string>();
    const cache = this.deps.hashCache;
    if (!cache) return hits;
    for (const hit of hits) {
      const fileHash = hit.chunk.fileHash;
      const entry = cache.get(fileHash);
      const chunks = entry?.status === 'ok' ? entry.chunks : undefined;
      if (!chunks || chunks.length === 0) {
        if (!seen.has(hit.chunk.id)) { out.push(hit); seen.add(hit.chunk.id); }
        continue;
      }
      const idx = chunks.findIndex((c: Chunk) => c.id === hit.chunk.id);
      if (idx === -1) {
        if (!seen.has(hit.chunk.id)) { out.push(hit); seen.add(hit.chunk.id); }
        continue;
      }
      const start = Math.max(0, idx - count);
      const end = Math.min(chunks.length, idx + count + 1);
      for (let i = start; i < end; i++) {
        const c = chunks[i];
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        // 保持 hit 的 filePath（可能已被 SearchService 改写成 display path）
        const displayChunk = i === idx ? hit.chunk : { ...c, filePath: hit.chunk.filePath };
        out.push({
          chunk: displayChunk,
          bm25Score: i === idx ? hit.bm25Score : undefined,
          vectorScore: i === idx ? hit.vectorScore : undefined,
          rrfScore: i === idx ? hit.rrfScore : undefined,
          finalRank: out.length,
        });
      }
    }
    return out;
  }

  private buildMessages(
    systemPrompt: string,
    citations: Citation[],
    hits: SearchHit[],
    history: ChatTurn[],
    userText: string
  ): ChatMessage[] {
    const lines: string[] = [systemPrompt, '', '== 资料 =='];
    let budget = MAX_CONTEXT_TOKENS;
    for (let i = 0; i < hits.length; i++) {
      const c = citations[i];
      const chunk = hits[i].chunk;
      const block = `[${c.index}] ${c.headingPath.join(' > ') || '(无标题)'} — ${c.filePath}\n${chunk.content}\n`;
      const estTokens = chunk.tokenCount + 30;
      if (estTokens > budget && i > 0) break;
      lines.push(block);
      budget -= estTokens;
    }

    const fullSystem = lines.join('\n');
    const messages: ChatMessage[] = [{ role: 'system', content: fullSystem }];
    for (const t of history) {
      if (t.role === 'system') continue;
      if (t.error) continue;
      messages.push({ role: t.role, content: t.content });
    }
    messages.push({ role: 'user', content: userText });
    return messages;
  }
}
