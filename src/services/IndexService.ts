import type { IVaultAdapter, IDataStoreAdapter } from 'src/adapters/types';
import type { StoragePaths } from 'src/storage/paths';
import type { Clock } from 'src/infra/clock';
import type { Logger } from 'src/infra/logger';
import type { NotebookId, Notebook, NotebookTransientFileError, NotebookPersistentFileError, Chunk, HashCacheEntry } from 'src/types/data';
import type { HashCacheStore } from 'src/indexer/hashCache';
import type { PathMapStore } from 'src/indexer/pathMap';
import type { BM25Store } from 'src/retrieval/bm25';
import type { IndexerEventBus } from 'src/indexer/events';
import type { ChunkProduct, ScanResult } from 'src/indexer/types';
import type { ExtractorRegistry } from 'src/extraction/registry';
import type { ScannedFile } from 'src/indexer/scan';
import type { IWorkerHost } from 'src/extraction/worker/types';
import type { LaneScheduler } from 'src/extraction/worker/laneScheduler';
import type { EmbeddingClient } from 'src/embedding/types';
import { WorkerHostError } from 'src/extraction/worker/types';

import { scanDiff } from 'src/indexer/scan';
import { runPipeline, type BM25Handle } from 'src/indexer/pipeline';
import { runCompaction, recoverFromLock } from 'src/indexer/compaction';
import { matchesNotebookScope, resolveSourceId } from 'src/indexer/scope';
import { chunkFile } from 'src/chunking/chunkFile';
import { toChunkerConfig, CHUNKING_VERSION, computeParserVersion } from 'src/chunking/types';
import { readJson, writeJson } from 'src/storage/json';
import { computeHash } from 'src/utils/hash';
import { isOverHardLimit } from './officeLimits';

export interface NotebookStatePort {
  getNotebook(id: NotebookId): Promise<Notebook | null>;
  persistState(id: NotebookId, patch: Partial<Notebook>): Promise<void>;
}

export interface IndexServiceDeps {
  vault: IVaultAdapter;
  dataStore: IDataStoreAdapter;
  paths: StoragePaths;
  hashCache: HashCacheStore;
  pathMap: PathMapStore;
  getBM25: (id: NotebookId) => BM25Store;
  clock: Clock;
  logger?: Logger;
  eventBus: IndexerEventBus;
  notebookStatePort: NotebookStatePort;
  extractorRegistry: ExtractorRegistry;
  platform: { isMobile: boolean };   // T11
  workerHost: IWorkerHost;            // T12
  laneScheduler: LaneScheduler;       // T12
  /** optional — absent means embedding phase is skipped */
  embeddingClient?: EmbeddingClient;
  /** called when all embeddings invalidated (e.g. model change) */
  onEmbeddingsInvalidated?: () => void;
  /** main-thread extractor for image formats (vision LLM + OCR); routes around workerHost */
  imageExtractor?: import('src/extraction/types').Extractor;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'gif']);
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  bmp: 'image/bmp',
  gif: 'image/gif',
};

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(d);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

const COMPACTION_SIZE_THRESHOLD_BYTES = 10 * 1024 * 1024;

interface CompactMeta {
  schemaVersion: 1;
  hashesLinesAtLastCompact: number;
  pathsLinesAtLastCompact: number;
  lastCompactedAt: number;
}

function extractorOptsKey(ext: string, notebook: Notebook): string {
  if (ext === 'pptx') {
    return JSON.stringify({ includeNotes: notebook.officeOptions?.includePptxNotes ?? false });
  }
  return '';
}

export class IndexService {
  private readonly locks = new Map<NotebookId, Promise<void>>();

  constructor(private readonly deps: IndexServiceDeps) {}

  async recoverAtStartup(): Promise<void> {
    await recoverFromLock(this.deps.dataStore, this.deps.paths);
  }

  async markDirty(notebookId: NotebookId): Promise<void> {
    await this.deps.notebookStatePort.persistState(notebookId, { status: 'dirty' });
    this.deps.eventBus.emit('index:dirty-changed', { notebookId, dirty: true, reason: 'vault-event' });
  }

  async ensureBM25ForNotebook(notebookId: NotebookId): Promise<void> {
    const notebook = await this.deps.notebookStatePort.getNotebook(notebookId);
    if (!notebook) return;
    const bm25 = this.deps.getBM25(notebookId);
    const ok = await bm25.load();
    if (ok) return;

    bm25.clear();
    const seenHashes = new Set<string>();
    let staleCount = 0;
    for (const entry of this.deps.pathMap.allAliveEntries()) {
      if (!matchesNotebookScope(entry.filePath, notebook)) continue;
      if (seenHashes.has(entry.fileHash)) continue;
      seenHashes.add(entry.fileHash);
      const hce = this.deps.hashCache.get(entry.fileHash);
      if (!hce || hce.status !== 'ok') continue;

      const path = this.deps.pathMap.alivePathsFor(entry.fileHash)[0];
      const ext = path?.split('.').pop()?.toLowerCase() ?? '';
      const cachedExtractor = this.deps.extractorRegistry.syncGet(ext);
      if (!cachedExtractor) { staleCount++; continue; }
      const expected = computeParserVersion(cachedExtractor.version, extractorOptsKey(ext, notebook));
      if (hce.chunkingVersion !== CHUNKING_VERSION || hce.parserVersion !== expected) {
        staleCount++;
        continue;
      }

      bm25.add(hce.chunks);
    }
    await bm25.persist();
    this.deps.logger?.info(
      `bm25 rebuilt for ${notebookId} (${seenHashes.size - staleCount} current + ${staleCount} stale-version skipped)`
    );
  }

  async reindex(notebookId: NotebookId, signal?: AbortSignal): Promise<void> {
    const prev = this.locks.get(notebookId) ?? Promise.resolve();
    const run = prev.then(() => this.reindexInner(notebookId, signal));
    this.locks.set(notebookId, run.catch(() => {}));
    await run;
  }

  private async reindexInner(notebookId: NotebookId, signal?: AbortSignal): Promise<void> {
    const notebook = await this.deps.notebookStatePort.getNotebook(notebookId);
    if (!notebook) throw new Error(`notebook not found: ${notebookId}`);

    await this.deps.notebookStatePort.persistState(notebookId, { status: 'indexing' });

    const chunkerConfig = toChunkerConfig(notebook.indexConfig);
    await this.ensureBM25ForNotebook(notebookId);
    const bm25 = this.deps.getBM25(notebookId);

    const pathInScope = (p: string) => matchesNotebookScope(p, notebook);

    const scanned = await this.scanNotebookFiles(notebook);

    const isFileCacheCurrent = (path: string, hash: string): boolean => {
      const hce = this.deps.hashCache.get(hash);
      if (!hce) return true;
      if (hce.status !== 'ok' && hce.status !== 'error') return true;
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const cachedExtractor = this.deps.extractorRegistry.syncGet(ext);
      if (!cachedExtractor) return true;
      const expected = computeParserVersion(cachedExtractor.version, extractorOptsKey(ext, notebook));
      return hce.parserVersion === expected;
    };

    const scanResult: ScanResult = await scanDiff(
      scanned, this.deps.pathMap, pathInScope, computeHash,
      {
        fileSizeByHash: (hash) => this.deps.hashCache.get(hash)?.fileSize,
        isFileCacheCurrent,
      },
    );

    const producer = async (path: string): Promise<ChunkProduct> => {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

      const stat = await this.deps.vault.stat(path);
      if (!stat) return { kind: 'error', hash: '', size: 0, parserVersion: 0, errorMessage: `file gone: ${path}` };

      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const extractor = await this.deps.extractorRegistry.get(ext);
      if (!extractor) {
        return { kind: 'error', hash: '', size: stat.size, parserVersion: 0, errorMessage: `no extractor for .${ext}` };
      }

      const parserVersion = computeParserVersion(extractor.version, extractorOptsKey(ext, notebook));

      // Defensive hard-limit recheck (scan already filtered, but stat may drift between scan and producer)
      if (isOverHardLimit(ext, stat.size, this.deps.platform.isMobile)) {
        return { kind: 'error', hash: '', size: stat.size, parserVersion,
                 errorMessage: `over hard limit: ${stat.size}` };
      }

      let buffer: ArrayBuffer;
      try {
        if (ext === 'md' || ext === 'txt') {
          buffer = new TextEncoder().encode(await this.deps.vault.read(path)).buffer;
        } else {
          buffer = await this.deps.vault.readBinary(path);
        }
      } catch (e) {
        return { kind: 'error', hash: '', size: stat.size, parserVersion,
                 errorMessage: `read failed: ${e instanceof Error ? e.message : String(e)}` };
      }

      const opts: Record<string, unknown> = ext === 'pptx'
        ? { includeNotes: notebook.officeOptions?.includePptxNotes ?? false }
        : {};

      try {
        const result = await this.deps.laneScheduler.run(stat.size, ext, async () => {
          if (IMAGE_EXTS.has(ext) && this.deps.imageExtractor) {
            const hash = await sha256Hex(buffer);
            const out = await this.deps.imageExtractor.extract(buffer, {
              ...opts,
              filename: path,
              mimeType: IMAGE_MIME[ext] ?? 'image/png',
              signal,
            });
            return { hash, markdown: out.markdown, locatorMap: out.locatorMap };
          }
          return this.deps.workerHost.extract({ ext, buffer, opts }, signal);
        });
        const chunks = await chunkFile(result.markdown, {
          filePath: path,
          sourceId: resolveSourceId(path, notebook) ?? notebook.sources[0]?.id ?? '',
          fileHash: result.hash,
          config: chunkerConfig,
          locatorMap: result.locatorMap,
        });
        // Embedding phase — skipped silently if no embeddingClient
        const embClient = this.deps.embeddingClient;
        if (embClient) {
          const hce = this.deps.hashCache.get(result.hash);
          if (shouldReEmbed(chunks, hce ?? {} as HashCacheEntry, embClient.modelId)) {
            try {
              const batches = batchByTokens(chunks);
              const allVecs: Record<string, number[]> = {};
              for (const batch of batches) {
                const texts = batch.map(c => c.content.slice(0, MAX_SINGLE_CHUNK_TOKENS * 4));
                const vecs = await embClient.embedDocuments(texts, { signal });
                batch.forEach((c, i) => { allVecs[c.id] = vecs[i]; });
              }
              return {
                kind: 'ok', hash: result.hash, size: stat.size, parserVersion, chunks,
                embeddings: allVecs, embeddingModelId: embClient.modelId,
              };
            } catch (embErr) {
              if (embErr instanceof DOMException && embErr.name === 'AbortError') throw embErr;
              const errMsg = embErr instanceof Error ? embErr.message : String(embErr);
              this.deps.logger?.warn(`embedding failed for ${path}: ${errMsg}`);
              return {
                kind: 'ok', hash: result.hash, size: stat.size, parserVersion, chunks,
                embeddingError: errMsg,
              };
            }
          }
        }
        return { kind: 'ok', hash: result.hash, size: stat.size, parserVersion, chunks };
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        if (e instanceof WorkerHostError) {
          if (e.errorClass === 'parse') {
            return { kind: 'error', hash: '', size: stat.size, parserVersion, errorMessage: e.message };
          }
          // timeout / worker-crash → transient (no HashCache write, pipeline records transient)
          return { kind: 'transient', errorMessage: `${e.errorClass}: ${e.message}` };
        }
        // Unknown exception: conservatively classify as deterministic error
        return { kind: 'error', hash: '', size: stat.size, parserVersion,
                 errorMessage: e instanceof Error ? e.message : String(e) };
      }
    };

    const bm25Handle: BM25Handle = {
      add: (cs) => bm25.add(cs),
      discardByIds: (ids) => bm25.discardByIds(ids),
      persist: () => bm25.persist(),
    };

    const alivePathsInNotebook = (hash: string): string[] =>
      this.deps.pathMap.alivePathsFor(hash).filter(pathInScope);

    const transientErrors: NotebookTransientFileError[] = [];
    const persistentErrors: NotebookPersistentFileError[] = [];

    try {
      await runPipeline(scanResult, {
        notebookId,
        hashCache: this.deps.hashCache,
        pathMap: this.deps.pathMap,
        bm25: bm25Handle,
        producer,
        clock: this.deps.clock,
        eventBus: this.deps.eventBus,
        alivePathsInNotebook,
        pathInScope,
        recordTransientError: (path, message) => {
          transientErrors.push({ path, message, ts: this.deps.clock.now() });
          if (transientErrors.length > 20) transientErrors.shift();
        },
        recordPersistentError: (path, message) => {
          persistentErrors.push({ path, message, ts: this.deps.clock.now() });
          if (persistentErrors.length > 20) persistentErrors.shift();
        },
        persistNotebookState: async (stats) => {
          await this.deps.notebookStatePort.persistState(notebookId, {
            stats,
            lastIndexedAt: this.deps.clock.now(),
            lastIndexVersion: CHUNKING_VERSION,
            status: 'idle',
            lastIndexError: undefined,
            transientFileErrors: transientErrors.length > 0 ? transientErrors : undefined,
            persistentFileErrors: persistentErrors.length > 0 ? persistentErrors : undefined,
          });
        },
        signal,
      });
    } catch (e) {
      await this.deps.notebookStatePort.persistState(notebookId, {
        status: 'error',
        lastIndexError: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  private async scanNotebookFiles(notebook: Notebook): Promise<ScannedFile[]> {
    const exts = notebook.fileExtensions ?? ['md'];
    const all = await this.deps.vault.getFiles({ extensions: exts });
    const out: ScannedFile[] = [];
    for (const f of all) {
      if (!matchesNotebookScope(f.path, notebook)) continue;
      const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
      if (isOverHardLimit(ext, f.stat.size, this.deps.platform.isMobile)) {
        this.deps.logger?.warn(`scan: skip ${f.path} (> hard limit, ${f.stat.size} bytes)`);
        continue;
      }
      let bytes: Uint8Array;
      if (ext === 'md' || ext === 'txt') {
        bytes = new TextEncoder().encode(await this.deps.vault.read(f.path));
      } else {
        bytes = new Uint8Array(await this.deps.vault.readBinary(f.path));
      }
      out.push({ path: f.path, sourceMtime: f.stat.mtime, fileSize: f.stat.size, contentBytes: bytes });
    }
    return out;
  }

  async maybeCompact(): Promise<boolean> {
    if (!(await this.shouldCompact())) return false;
    await runCompaction(this.deps.dataStore, this.deps.paths, this.deps.hashCache, this.deps.pathMap);
    await this.writeCompactMeta();
    return true;
  }

  private async shouldCompact(): Promise<boolean> {
    const rawHashes = (await this.deps.dataStore.read(this.deps.paths.hashesJsonl)) ?? '';
    const rawPaths  = (await this.deps.dataStore.read(this.deps.paths.pathsJsonl))  ?? '';
    if (rawHashes.length > COMPACTION_SIZE_THRESHOLD_BYTES) return true;
    if (rawPaths.length  > COMPACTION_SIZE_THRESHOLD_BYTES) return true;

    const hashesLines = countLines(rawHashes);
    const pathsLines  = countLines(rawPaths);
    const meta = await this.readCompactMeta();
    if (meta) {
      if (hashesLines > meta.hashesLinesAtLastCompact * 2) return true;
      if (pathsLines  > meta.pathsLinesAtLastCompact  * 2) return true;
    } else {
      if (hashesLines > 1000 || pathsLines > 1000) return true;
    }
    return false;
  }

  private async readCompactMeta(): Promise<CompactMeta | null> {
    return readJson<CompactMeta>(this.deps.dataStore, this.deps.paths.compactMeta);
  }

  private async writeCompactMeta(): Promise<void> {
    const rawHashes = (await this.deps.dataStore.read(this.deps.paths.hashesJsonl)) ?? '';
    const rawPaths  = (await this.deps.dataStore.read(this.deps.paths.pathsJsonl))  ?? '';
    const meta: CompactMeta = {
      schemaVersion: 1,
      hashesLinesAtLastCompact: countLines(rawHashes),
      pathsLinesAtLastCompact: countLines(rawPaths),
      lastCompactedAt: this.deps.clock.now(),
    };
    await writeJson(this.deps.dataStore, this.deps.paths.compactMeta, meta);
  }
}

function countLines(s: string): number {
  if (!s) return 0;
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++;
  if (s.length > 0 && s[s.length - 1] !== '\n') n++;
  return n;
}

const MAX_BATCH_TOKENS = 8_192;
const MAX_BATCH_COUNT = 96;
const MAX_SINGLE_CHUNK_TOKENS = 512;

export function batchByTokens(chunks: Chunk[]): Chunk[][] {
  const batches: Chunk[][] = [];
  let current: Chunk[] = [];
  let tokens = 0;
  for (const c of chunks) {
    if (tokens + c.tokenCount > MAX_BATCH_TOKENS || current.length >= MAX_BATCH_COUNT) {
      if (current.length > 0) batches.push(current);
      current = [c];
      tokens = c.tokenCount;
    } else {
      current.push(c);
      tokens += c.tokenCount;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function shouldReEmbed(
  chunks: Chunk[],
  entry: HashCacheEntry,
  currentModelId: string,
): boolean {
  if (!entry.embeddingModelId || entry.embeddingModelId !== currentModelId) return true;
  const storedIds = new Set(Object.keys(entry.embeddings ?? {}));
  const newIds = new Set(chunks.map(c => c.id));
  if (storedIds.size !== newIds.size) return true;
  for (const id of newIds) if (!storedIds.has(id)) return true;
  return false;
}

export async function invalidateAllEmbeddings(
  hashCache: HashCacheStore,
  onInvalidated: () => void,
): Promise<void> {
  let anyChanged = false;
  for (const entry of hashCache.aliveEntries()) {
    if (entry.embeddingModelId !== undefined) {
      await hashCache.append({
        ...entry,
        embeddingModelId: undefined,
        embeddings: undefined,
        embeddingError: undefined,
      });
      anyChanged = true;
    }
  }
  if (anyChanged) onInvalidated();
}
