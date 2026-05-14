import type { NotebookId, Notebook, Chunk } from 'src/types/data';
import type { Citation } from 'src/types/chat';
import type {
  Artifact,
  ArtifactKind,
  GenerationStreamEvent,
  GenerateOptions,
} from 'src/types/artifact';
import type { HashCacheStore } from 'src/indexer/hashCache';
import type { PathMapStore } from 'src/indexer/pathMap';
import type { Clock } from 'src/infra/clock';
import type { Logger } from 'src/infra/logger';
import type { LLMClient, ChatMessage } from 'src/providers/types';
import { matchesNotebookScope } from 'src/indexer/scope';
import { CHUNKING_VERSION } from 'src/chunking/types';
import { GENERATORS } from 'src/generation/generators';

// 资料预算:覆盖典型 vault 全量。主流大模型 context 普遍 128K-256K
// (K2.6=128K, deepseek-v3=128K, qwen-max-latest=131K, moonshot-v1-128k/256k),
// 留出 ~30K 给 system prompt + reasoning + output。
// 这里设 200K 是为多数 vault 一次喂完,只有真正超大库(>= 1000 长 chunk)才触发截断。
const MAX_GENERATION_TOKENS = 200000;
// 输出预算:reasoning model(K2.x / R1 / o1)在 reasoning_content 上消耗 4-8k token
// 是常态,留足 12K 才能保证最终 content 不被截断为空(timeline 实测踩过这个坑)。
const ASSISTANT_MAX_TOKENS = 12000;

export interface ResolvedTaskClient {
  client: LLMClient;
  model: string;
}

export interface GenerationServiceDeps {
  hashCache: HashCacheStore;
  pathMap: PathMapStore;
  getNotebook: (id: NotebookId) => Promise<Notebook | null>;
  /** 解析 task='summary' (Phase 2 5 种产物全部走 summary 任务) */
  resolveTaskClient: () => ResolvedTaskClient | null;
  clock: Clock;
  logger?: Logger;
}

export class GenerationService {
  constructor(private readonly deps: GenerationServiceDeps) {}

  async *generate(
    notebookId: NotebookId,
    kind: ArtifactKind,
    opts: GenerateOptions = {}
  ): AsyncIterable<GenerationStreamEvent> {
    const { signal, title } = opts;
    let accContent = '';
    const config = GENERATORS[kind];

    try {
      yield { type: 'retrieving' };

      const notebook = await this.deps.getNotebook(notebookId);
      if (!notebook) {
        yield { type: 'error', error: `notebook not found: ${notebookId}` };
        return;
      }

      const chunks = this.collectNotebookChunks(notebook);
      if (chunks.length === 0) {
        yield { type: 'error', error: 'Notebook 为空或未索引,请先索引' };
        return;
      }

      const { citations, includedChunks, truncated } = this.buildCitationsAndBudget(chunks);
      yield { type: 'citations', citations, truncated };

      const resolved = this.deps.resolveTaskClient();
      if (!resolved) {
        yield { type: 'error', error: '未配置 summary 任务的模型;请到设置页指派' };
        return;
      }

      const messages = this.buildMessages(config.systemPrompt, citations, includedChunks);

      yield { type: 'generating' };

      const stream = resolved.client.chatStream({
        messages,
        model: resolved.model,
        maxTokens: ASSISTANT_MAX_TOKENS,
        signal,
      });

      for await (const ev of stream) {
        if (signal?.aborted) {
          // 取消不持久化 artifact;走 error 路径
          yield { type: 'error', error: '已取消' };
          return;
        }
        if (ev.type === 'error') {
          // provider 流内 error 事件 → 转抛给外层 catch 统一处理
          throw ev.error;
        }
        if (ev.type === 'delta' && ev.content) {
          accContent += ev.content;
          yield { type: 'token', content: ev.content };
        }
      }

      const artifact: Artifact = {
        id: crypto.randomUUID(),
        notebookId,
        kind,
        title: title?.trim() || config.defaultTitle,
        content: accContent,
        citations,
        modelUsed: resolved.model,
        generatedAt: this.deps.clock.now(),
        ...(truncated ? { truncated: true } : {}),
      };
      yield { type: 'done', artifact };
    } catch (e) {
      // 如果是因 abort 抛出(fetch/AbortError),统一转为"已取消"
      if (signal?.aborted) {
        yield { type: 'error', error: '已取消' };
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.deps.logger?.warn(`GenerationService.generate(${kind}) failed: ${msg}`);
      yield { type: 'error', error: msg };
    }
  }

  /** 枚举 notebook 范围内所有 alive chunk(按 filePath + chunkIndex 排序去重)。 */
  private collectNotebookChunks(notebook: Notebook): Chunk[] {
    const seenChunkIds = new Set<string>();
    const result: Chunk[] = [];
    for (const entry of this.deps.pathMap.allAliveEntries()) {
      if (!matchesNotebookScope(entry.filePath, notebook)) continue;
      const hce = this.deps.hashCache.get(entry.fileHash);
      if (!hce || hce.status !== 'ok') continue;
      if (hce.chunkingVersion !== CHUNKING_VERSION) continue;
      for (const c of hce.chunks) {
        if (seenChunkIds.has(c.id)) continue;
        seenChunkIds.add(c.id);
        result.push(c);
      }
    }
    return result.sort((a, b) =>
      a.filePath === b.filePath ? a.chunkIndex - b.chunkIndex : a.filePath.localeCompare(b.filePath)
    );
  }

  private buildCitationsAndBudget(allChunks: Chunk[]): {
    citations: Citation[];
    includedChunks: Chunk[];
    truncated: boolean;
  } {
    const citations: Citation[] = [];
    const included: Chunk[] = [];
    let budget = MAX_GENERATION_TOKENS;
    let truncated = false;
    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      const est = chunk.tokenCount + 30;
      // i>0 守护:确保至少包含 1 个 chunk(即使首块就超预算)
      if (est > budget && i > 0) {
        truncated = true;
        break;
      }
      included.push(chunk);
      citations.push({
        index: included.length,
        chunkId: chunk.id,
        filePath: chunk.filePath,
        headingPath: chunk.headingPath,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        preview: chunk.content.slice(0, 200),
      });
      budget -= est;
    }
    return { citations, includedChunks: included, truncated };
  }

  private buildMessages(
    systemPrompt: string,
    citations: Citation[],
    chunks: Chunk[]
  ): ChatMessage[] {
    const lines: string[] = [systemPrompt, '', '== 资料 =='];
    for (let i = 0; i < chunks.length; i++) {
      const c = citations[i];
      const chunk = chunks[i];
      lines.push(`[${c.index}] ${c.headingPath.join(' > ') || '(无标题)'} — ${c.filePath}`);
      lines.push(chunk.content);
      lines.push('');
    }
    return [
      { role: 'system', content: lines.join('\n') },
      { role: 'user', content: '请基于上述资料生成。' },
    ];
  }
}
