import MiniSearch from 'minisearch';
import type { NotebookId, HashCacheEntry, Notebook } from 'src/types/data';
import type { HashCacheStore } from 'src/indexer/hashCache';
import type { PathMapStore } from 'src/indexer/pathMap';
import type { LLMClient, ChatMessage } from 'src/providers/types';
import type { Logger } from 'src/infra/logger';
import { matchesNotebookScope } from 'src/indexer/scope';
import { segmentWords } from 'src/chunking/tokenize';

// 摘要生成时给 LLM 的最大输入长度(字符)。超过则截断 — 摘要主要看开头/总体,
// 6k 字符(约 1.5k tokens)够覆盖典型文档的标题/前言/结论位置。
const SUMMARY_INPUT_MAX_CHARS = 6000;
const SUMMARY_OUTPUT_MAX_TOKENS = 300;
// 60s — 国内 LLM 在高峰期/复杂输入下可能要 20-40s,30s 经常误杀。
// 实际 LLM 仍可能 stream 中途 inactive,这是网络问题不是模型问题。
const SUMMARY_TIMEOUT_MS = 60000;
// 429 / 503 / overloaded 重试。每次失败后指数退避并加随机抖动,避免雪崩。
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 20000;

const SUMMARY_SYSTEM_PROMPT = [
  '你是文档摘要专家。',
  '请用 200 字以内总结这份文档的核心内容、关键论断、关键结论、要点。',
  '聚焦事实信息和实质内容,忽略格式细节、页眉页脚、署名等。',
  '直接输出摘要正文,不要加「摘要:」「以下是摘要:」等前缀。',
].join('\n');

export interface SummaryProgress {
  notebookId: NotebookId;
  done: number;
  failed: number;
  total: number;
  inFlight: number;
  /** 已跳过的"无可摘要内容"文档数(扫描版 PDF / 空 docx 等) */
  skipped?: number;
  /** 最近一次失败的错误信息(给 UI 排查用) */
  lastError?: string;
}

export interface BackfillOptions {
  signal?: AbortSignal;
  concurrency?: number;
  onProgress?: (p: SummaryProgress) => void;
}

/** 可重试错误判定 — HTTP 429/502/503/504,或文本含 overload / rate limit。 */
function isRetryableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /HTTP (429|502|503|504)/i.test(msg)
    || /overload|rate.?limit|too many requests|engine.busy/i.test(msg);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface SummaryServiceDeps {
  hashCache: HashCacheStore;
  pathMap: PathMapStore;
  getNotebook: (id: NotebookId) => Promise<Notebook | null>;
  resolveSummaryClient: () => { client: LLMClient; model: string } | null;
  logger?: Logger;
}

interface SummaryDoc {
  id: string;
  text: string;
}

/**
 * 把任意错误对象转成对 UI 可读的字符串。Error.message 可能为空(某些 LLM SDK
 * 抛 new Error() 不带 message),需要 fallback 到 name/toString/JSON 才不会显示空白。
 */
function formatError(e: unknown): string {
  if (e instanceof Error) {
    const parts = [e.name, e.message].filter(s => s && s.length > 0);
    if (parts.length > 0) return parts.join(': ');
    try {
      return e.toString();
    } catch {
      return 'unknown Error';
    }
  }
  if (e === null) return 'null';
  if (e === undefined) return 'undefined';
  if (typeof e === 'string') return e || 'empty string error';
  if (typeof e === 'object') {
    try {
      const s = JSON.stringify(e);
      if (s && s !== '{}') return s;
    } catch { /* circular ref */ }
    try { return String(e); } catch { return 'unstringifiable object'; }
  }
  return String(e);
}

/**
 * 文档级摘要生成 + 检索。
 *
 * 生成:对一个 notebook 内所有 alive 文档,补齐缺失的 summary。 调 LLM,带并发控制和取消支持。
 * 进度通过 onProgress 回调推送(主线程可订阅给 UI)。
 *
 * 检索:对一个 notebook 现场建 in-memory BM25(over summaries),
 *     返回 top-K 文档的 fileHash 列表。 BM25 over 2-3 千条短摘要构建 < 100ms,
 *     每次 chat 重建可接受,不必持久化。
 */
export class SummaryService {
  constructor(private readonly deps: SummaryServiceDeps) {}

  /**
   * 为 notebook 内所有 alive 文档补齐缺失的 summary。已有 summary 的跳过。
   */
  async backfill(notebookId: NotebookId, opts: BackfillOptions = {}): Promise<{ done: number; failed: number; total: number }> {
    const notebook = await this.deps.getNotebook(notebookId);
    if (!notebook) throw new Error(`notebook not found: ${notebookId}`);
    const resolved = this.deps.resolveSummaryClient();
    if (!resolved) throw new Error('summary 任务未配置 LLM provider');

    // 先按"未生成 summary"过滤,然后再筛掉"没有可摘要内容"(扫描版 PDF / 空 docx /
     // 仅含图片的文档等)。后者由 LLM 也无能为力,作为 skipped 单独计,不计 failed。
    const candidates = this.collectEntriesInScope(notebook).filter(e => !e.summary);
    const hasContent = (e: HashCacheEntry): boolean =>
      e.chunks.some(c => c.content && c.content.trim().length > 0);
    const entries = candidates.filter(hasContent);
    const skipped = candidates.length - entries.length;
    const total = entries.length;
    if (total === 0) return { done: 0, failed: 0, total: 0 };

    // 默认并发 1:moonshot 等国内 provider 高峰期 engine_overloaded 频发,
    // 多并发只会加剧雪崩。Backfill 是后台任务,慢一点没关系,关键是不失败。
    // 用户可在 UI 选项里手动调高(并配合指数退避重试)。
    const concurrency = Math.max(1, Math.min(opts.concurrency ?? 1, 8));
    let done = 0;
    let failed = 0;
    let inFlight = 0;
    let lastError: string | undefined;
    const report = () => opts.onProgress?.({ notebookId, done, failed, total, inFlight, skipped, lastError });
    report();

    let cursor = 0;
    const workers: Promise<void>[] = [];
    const worker = async (): Promise<void> => {
      while (cursor < entries.length) {
        if (opts.signal?.aborted) return;
        const idx = cursor++;
        const entry = entries[idx];
        inFlight++;
        report();
        try {
          const summary = await this.generateForEntry(entry, resolved.client, resolved.model, opts.signal);
          await this.deps.hashCache.append({
            ...entry,
            summary,
            summaryModelId: resolved.model,
          });
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          failed++;
          const msg = formatError(e);
          lastError = msg;
          // 同时打 error 级日志,带完整 stack — 用户能在 devtools 看到全貌
          this.deps.logger?.error(`summary failed for ${entry.fileHash}: ${msg}`, e);
        } finally {
          inFlight--;
          done++;
          report();
        }
      }
    };
    for (let i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);

    return { done: done - failed, failed, total };
  }

  /**
   * 在 notebook 范围内,对所有有 summary 的文档建 in-memory BM25,
   * 返回最相关的前 topK 个文档的 fileHash。
   */
  async searchTopDocuments(notebookId: NotebookId, query: string, topK: number): Promise<string[]> {
    const notebook = await this.deps.getNotebook(notebookId);
    if (!notebook) return [];
    const entries = this.collectEntriesInScope(notebook).filter(e => e.summary);
    if (entries.length === 0) return [];

    const ms = new MiniSearch<SummaryDoc>({
      fields: ['text'],
      storeFields: ['id'],
      idField: 'id',
      tokenize: s => segmentWords(s),
      searchOptions: { tokenize: s => segmentWords(s), fuzzy: 0.1, prefix: true, combineWith: 'OR' },
    });
    ms.addAll(entries.map(e => ({ id: e.fileHash, text: e.summary! })));

    const hits = ms.search(query);
    return hits.slice(0, topK).map(h => String(h.id));
  }

  /** 统计 notebook 范围内 summary 覆盖情况。 */
  async coverage(notebookId: NotebookId): Promise<{ total: number; withSummary: number }> {
    const notebook = await this.deps.getNotebook(notebookId);
    if (!notebook) return { total: 0, withSummary: 0 };
    const entries = this.collectEntriesInScope(notebook);
    return {
      total: entries.length,
      withSummary: entries.filter(e => !!e.summary).length,
    };
  }

  private collectEntriesInScope(notebook: Notebook): HashCacheEntry[] {
    const seen = new Set<string>();
    const out: HashCacheEntry[] = [];
    for (const pme of this.deps.pathMap.allAliveEntries()) {
      if (!matchesNotebookScope(pme.filePath, notebook)) continue;
      if (seen.has(pme.fileHash)) continue;
      seen.add(pme.fileHash);
      const hce = this.deps.hashCache.get(pme.fileHash);
      if (!hce || hce.status !== 'ok') continue;
      out.push(hce);
    }
    return out;
  }

  private async generateForEntry(
    entry: HashCacheEntry,
    client: LLMClient,
    model: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const content = entry.chunks.map(c => c.content).join('\n').slice(0, SUMMARY_INPUT_MAX_CHARS);
    if (!content.trim()) {
      throw new Error(`document has no extractable content (fileHash=${entry.fileHash})`);
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content },
    ];

    // 重试包装:对 429/503/overload 做指数退避重试,而不是直接失败。
    // 每次重试都用新的 timeout signal,避免老的 timeout 累计。
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const callSignal = AbortSignal.any([
        AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
        ...(signal ? [signal] : []),
      ]);
      try {
        // 使用非流式 chat() 而非 chatStream():
        //   1) summary 不需要流式输出,300 字结果一次拿回即可
        //   2) 部分 reasoning model 在 SSE delta 里只返回 reasoning_content,
        //      非流式 API 的 message.content 字段更规范。
        const result = await client.chat({
          messages, model,
          maxTokens: SUMMARY_OUTPUT_MAX_TOKENS,
          signal: callSignal,
        });
        const text = result.content.trim();
        if (!text) {
          throw new Error(`LLM returned empty content (model=${model}, input=${content.length} chars) — 该模型可能未把答案放在 message.content 里,建议换一个普通 chat 模型`);
        }
        return text;
      } catch (e) {
        lastErr = e;
        if (signal?.aborted) throw e;
        if (e instanceof DOMException && e.name === 'AbortError') {
          // 区分:是外部 cancel 还是本次 attempt 的 timeout
          if (signal?.aborted) throw e;
          // 单次 timeout — 允许重试
        } else if (!isRetryableError(e)) {
          throw e;
        }
        if (attempt === MAX_RETRIES - 1) break;
        const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, attempt)) + Math.random() * 500;
        this.deps.logger?.warn(`summary attempt ${attempt + 1}/${MAX_RETRIES} failed (${e instanceof Error ? e.message : String(e)}), retrying in ${Math.round(wait)}ms`);
        await sleep(wait, signal);
      }
    }
    throw lastErr ?? new Error('unreachable');
  }
}
