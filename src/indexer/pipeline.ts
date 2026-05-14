import type { Clock } from 'src/infra/clock';
import type { NotebookId, Chunk } from 'src/types/data';
import type { HashCacheStore } from 'src/indexer/hashCache';
import type { PathMapStore } from 'src/indexer/pathMap';
import type { ScanResult, ChunkProduct, DiffEntry } from 'src/indexer/types';
import type { IndexerEventBus } from 'src/indexer/events';
import { CHUNKING_VERSION } from 'src/chunking/types';

export interface BM25Handle {
  add(chunks: Chunk[]): void;
  discardByIds(ids: string[]): void;
  persist(): Promise<void>;
}

export type ChunkProducer = (path: string) => Promise<ChunkProduct>;

export interface PipelineDeps {
  notebookId: NotebookId;
  hashCache: HashCacheStore;
  pathMap: PathMapStore;
  bm25: BM25Handle;
  producer: ChunkProducer;
  clock: Clock;
  eventBus: IndexerEventBus;
  alivePathsInNotebook: (hash: string) => string[];
  pathInScope: (path: string) => boolean;
  persistNotebookState: (stats: { fileCount: number; chunkCount: number }) => Promise<void>;
  signal?: AbortSignal;
  /** 累积 transient 错误,由调用方持久化到 notebook.transientFileErrors。 */
  recordTransientError?: (path: string, message: string) => void;
  /** 累积 deterministic parse 错误,由调用方持久化到 notebook.persistentFileErrors。 */
  recordPersistentError?: (path: string, message: string) => void;
}

export const PIPELINE_BATCH_SIZE = 50;
export const PIPELINE_ERROR_THRESHOLD = 0.5;
/**
 * 阈值评估前需要的最少样本数。低于此值的 batch 边界不评估错误率,
 * 避免少样本下个别坏文件被外推为"系统性故障"导致整个 notebook 索引阻断。
 */
export const PIPELINE_MIN_SAMPLES_FOR_THRESHOLD = 5;

export async function runPipeline(
  scan: ScanResult,
  deps: PipelineDeps
): Promise<void> {
  const startedAt = deps.clock.now();
  let done = 0;
  let errors = 0;

  const total = scan.entries.length;
  const fireProgress = (currentFile?: string) => {
    deps.eventBus.emit('index:progress', {
      notebookId: deps.notebookId, done, total, currentFile,
    });
  };

  try {
    for (let batchStart = 0; batchStart < scan.entries.length; batchStart += PIPELINE_BATCH_SIZE) {
      if (deps.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const batch = scan.entries.slice(batchStart, batchStart + PIPELINE_BATCH_SIZE);

      for (const entry of batch) {
        if (deps.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        try {
          await applyDiffEntry(entry, deps);
        } catch (e) {
          errors++;
          deps.eventBus.emit('index:error', {
            notebookId: deps.notebookId,
            error: e instanceof Error ? e.message : String(e),
            phase: 'chunk',
          });
        }
        done++;
        fireProgress(entry.filePath ?? entry.newPath);
      }

      if (done >= PIPELINE_MIN_SAMPLES_FOR_THRESHOLD && errors / done > PIPELINE_ERROR_THRESHOLD) {
        throw new Error(`error rate ${errors}/${done} exceeded ${PIPELINE_ERROR_THRESHOLD}`);
      }

      await new Promise(r => setTimeout(r, 0));
    }

    await deps.bm25.persist();

    const fileCount = countAlivePathsInScope(deps);
    const chunkCount = sumChunkCountInScope(deps);
    await deps.persistNotebookState({ fileCount, chunkCount });

    deps.eventBus.emit('index:complete', {
      notebookId: deps.notebookId,
      fileCount,
      chunkCount,
      durationMs: deps.clock.now() - startedAt,
    });
  } catch (e) {
    deps.eventBus.emit('index:error', {
      notebookId: deps.notebookId,
      error: e instanceof Error ? e.message : String(e),
      phase: 'persist',
    });
    throw e;
  }
}

async function applyDiffEntry(entry: DiffEntry, deps: PipelineDeps): Promise<void> {
  switch (entry.classification) {
    case 'UNCHANGED': {
      // STALE_PARSER 已在 scan 层覆盖版本不一致,这里只做"什么都不做"
      return;
    }

    case 'STALE_PARSER': {
      if (!entry.filePath || !entry.oldHash || entry.sourceMtime === undefined || entry.fileSize === undefined) return;
      const product = await deps.producer(entry.filePath);
      const now = deps.clock.now();

      if (product.kind === 'transient') {
        deps.recordTransientError?.(entry.filePath, product.errorMessage);
        return;
      }
      if (product.kind === 'error') {
        const hce = deps.hashCache.get(entry.oldHash);
        await deps.hashCache.append({
          fileHash: entry.oldHash,
          fileSize: hce?.fileSize ?? entry.fileSize,
          chunks: [],
          chunkingVersion: CHUNKING_VERSION,
          parserVersion: product.parserVersion,
          indexedAt: now,
          status: 'error',
          errorMessage: product.errorMessage,
        });
        deps.recordPersistentError?.(entry.filePath, product.errorMessage);
        return;
      }
      if (product.kind === 'skipped') {
        const hce = deps.hashCache.get(entry.oldHash);
        await deps.hashCache.append({
          fileHash: entry.oldHash,
          fileSize: hce?.fileSize ?? entry.fileSize,
          chunks: [],
          chunkingVersion: CHUNKING_VERSION,
          parserVersion: product.parserVersion,
          indexedAt: now,
          status: 'skipped',
          errorMessage: product.reason,
        });
        return;
      }
      if (product.hash !== entry.oldHash) {
        throw new Error(`STALE_PARSER hash mismatch ${entry.filePath}: expected=${entry.oldHash} produced=${product.hash}`);
      }

      const oldHce = deps.hashCache.get(entry.oldHash);
      if (oldHce) deps.bm25.discardByIds(oldHce.chunks.map(c => c.id));
      deps.bm25.add(product.chunks);
      await deps.hashCache.append({
        fileHash: entry.oldHash,
        fileSize: oldHce?.fileSize ?? entry.fileSize,
        chunks: product.chunks,
        chunkingVersion: CHUNKING_VERSION,
        parserVersion: product.parserVersion,
        indexedAt: now,
        status: 'ok',
        embeddings: product.embeddings,
        embeddingModelId: product.embeddingModelId,
        embeddingError: product.embeddingError,
      });
      return;
    }

    case 'MTIME_ONLY': {
      if (!entry.filePath || entry.oldHash === undefined || entry.sourceMtime === undefined) return;
      await deps.pathMap.append({
        filePath: entry.filePath,
        fileHash: entry.oldHash,
        sourceMtime: entry.sourceMtime,
        observedAt: deps.clock.now(),
      });
      return;
    }

    case 'NEW_PATH': {
      if (!entry.filePath || !entry.newHash || entry.sourceMtime === undefined || entry.fileSize === undefined) return;
      await handleNewContent(entry.filePath, entry.newHash, entry.sourceMtime, entry.fileSize, deps);
      return;
    }

    case 'RENAMED': {
      if (!entry.oldPath || !entry.newPath || !entry.newHash || entry.sourceMtime === undefined) return;
      await deps.pathMap.append({
        filePath: entry.oldPath,
        fileHash: entry.newHash,
        sourceMtime: 0,
        observedAt: deps.clock.now(),
        tombstone: true,
      });
      await deps.pathMap.append({
        filePath: entry.newPath,
        fileHash: entry.newHash,
        sourceMtime: entry.sourceMtime,
        observedAt: deps.clock.now(),
      });
      return;
    }

    case 'DELETED': {
      if (!entry.filePath) return;
      const oldHash = entry.oldHash;
      await deps.pathMap.append({
        filePath: entry.filePath,
        fileHash: oldHash ?? '',
        sourceMtime: 0,
        observedAt: deps.clock.now(),
        tombstone: true,
      });
      if (!oldHash) return;

      const remainingInScope = deps.alivePathsInNotebook(oldHash);
      if (remainingInScope.length === 0) {
        const oldEntry = deps.hashCache.get(oldHash);
        if (oldEntry) deps.bm25.discardByIds(oldEntry.chunks.map(c => c.id));
      }
      const remainingGlobal = deps.pathMap.alivePathsFor(oldHash);
      if (remainingGlobal.length === 0) {
        const prev = deps.hashCache.get(oldHash);
        if (prev) {
          await deps.hashCache.append({ ...prev, tombstone: true, indexedAt: deps.clock.now() });
        }
      }
      return;
    }

    case 'CONTENT_CHANGED': {
      if (!entry.filePath || !entry.newHash || !entry.oldHash || entry.sourceMtime === undefined || entry.fileSize === undefined) return;
      // 先提交新内容,再 discard 旧 BM25。handleNewContent 失败路径都 throw → case 提前退出 → 旧 BM25 保留
      await handleNewContent(entry.filePath, entry.newHash, entry.sourceMtime, entry.fileSize, deps);

      const remainingInScope = deps.alivePathsInNotebook(entry.oldHash);
      if (remainingInScope.length === 0) {
        const oldEntry = deps.hashCache.get(entry.oldHash);
        if (oldEntry) deps.bm25.discardByIds(oldEntry.chunks.map(c => c.id));
      }
      return;
    }
  }
}

async function handleNewContent(
  filePath: string,
  newHash: string,
  sourceMtime: number,
  fileSize: number,
  deps: PipelineDeps
): Promise<void> {
  const existing = deps.hashCache.get(newHash);

  // duplicate 短路:必须 ok 且 chunking 版本匹配(parserVersion 由 STALE_PARSER 分支负责更新)
  if (
    existing &&
    existing.status === 'ok' &&
    existing.chunkingVersion === CHUNKING_VERSION
  ) {
    await deps.pathMap.append({
      filePath, fileHash: newHash,
      sourceMtime, observedAt: deps.clock.now(),
    });
    return;
  }

  const product = await deps.producer(filePath);
  const now = deps.clock.now();

  // producer transient: 不写 HashCache,不推进 PathMap,记录但不抛错
  if (product.kind === 'transient') {
    deps.recordTransientError?.(filePath, product.errorMessage);
    return;
  }

  // producer error: 不推进 PathMap,记 HashCache error + persistent error,不抛错
  // (单文件 deterministic 错误不应阻断整个 pipeline,阈值守门仅作为系统性故障兜底)
  if (product.kind === 'error') {
    await deps.hashCache.append({
      fileHash: newHash,
      fileSize,
      chunks: [],
      chunkingVersion: CHUNKING_VERSION,
      parserVersion: product.parserVersion,
      indexedAt: now,
      status: 'error',
      errorMessage: product.errorMessage,
    });
    deps.recordPersistentError?.(filePath, product.errorMessage);
    return;
  }

  // skipped: 推进 PathMap(稳定态)
  if (product.kind === 'skipped') {
    await deps.hashCache.append({
      fileHash: newHash,
      fileSize,
      chunks: [],
      chunkingVersion: CHUNKING_VERSION,
      parserVersion: product.parserVersion,
      indexedAt: now,
      status: 'skipped',
      errorMessage: product.reason,
    });
    await deps.pathMap.append({ filePath, fileHash: newHash, sourceMtime, observedAt: now });
    return;
  }

  // hash mismatch: throw,让 runPipeline 计入 errors
  if (product.hash !== newHash) {
    deps.eventBus.emit('index:error', {
      notebookId: deps.notebookId,
      error: `hash mismatch for ${filePath}: scan=${newHash}, produce=${product.hash} (file changed mid-reindex, retry on next pass)`,
      phase: 'chunk',
    });
    throw new Error(`hash mismatch for ${filePath}`);
  }

  await deps.hashCache.append({
    fileHash: newHash,
    fileSize,
    chunks: product.chunks,
    chunkingVersion: CHUNKING_VERSION,
    parserVersion: product.parserVersion,
    indexedAt: now,
    status: 'ok',
    embeddings: product.embeddings,
    embeddingModelId: product.embeddingModelId,
    embeddingError: product.embeddingError,
  });
  await deps.pathMap.append({ filePath, fileHash: newHash, sourceMtime, observedAt: now });
  deps.bm25.add(product.chunks);
}

function countAlivePathsInScope(deps: PipelineDeps): number {
  let count = 0;
  for (const p of deps.pathMap.allAlivePaths()) {
    if (deps.pathInScope(p)) count++;
  }
  return count;
}

function sumChunkCountInScope(deps: PipelineDeps): number {
  let total = 0;
  const accountedHashes = new Set<string>();
  for (const entry of deps.pathMap.allAliveEntries()) {
    if (!deps.pathInScope(entry.filePath)) continue;
    if (accountedHashes.has(entry.fileHash)) continue;
    accountedHashes.add(entry.fileHash);
    const hce = deps.hashCache.get(entry.fileHash);
    if (hce) total += hce.chunks.length;
  }
  return total;
}
