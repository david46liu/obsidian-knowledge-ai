import type { NotebookId, Notebook, SearchHit, SearchOptions, Chunk } from 'src/types/data';
import type { HashCacheStore } from 'src/indexer/hashCache';
import type { PathMapStore } from 'src/indexer/pathMap';
import type { BM25Store } from 'src/retrieval/bm25';
import type { RerankerRegistry } from 'src/retrieval/rerank';
import type { EmbeddingClientRegistry } from 'src/embedding/registry';
import type { VectorStore } from 'src/embedding/vectorStore';
import { matchesNotebookScope } from 'src/indexer/scope';
import { CHUNKING_VERSION } from 'src/chunking/types';

const RRF_K = 60;

export interface SearchServiceDeps {
  hashCache: HashCacheStore;
  pathMap: PathMapStore;
  getBM25: (id: NotebookId) => BM25Store;
  getNotebook: (id: NotebookId) => Promise<Notebook | null>;
  reindex: (id: NotebookId) => Promise<void>;
  ensureBM25ForNotebook: (id: NotebookId) => Promise<void>;
  rerankers: RerankerRegistry;
  resolveRerankerName: () => string | undefined;
  /** optional — if absent, vector path is always skipped */
  embeddingRegistry?: EmbeddingClientRegistry;
  /** called once per search to get (or create) the VectorStore for a notebook */
  getVectorStore?: (notebookId: NotebookId) => VectorStore;
  onVectorStoreInvalidate?: (notebookId: NotebookId) => void;
}

export class SearchService {
  constructor(private readonly deps: SearchServiceDeps) {}

  async search(
    notebookId: NotebookId,
    query: string,
    opts: SearchOptions = {}
  ): Promise<SearchHit[]> {
    const topK = opts.topK ?? 10;
    const candidateK = opts.candidateK ?? 50;
    const rerank = opts.rerank ?? true;
    const staleOk = opts.staleOk ?? false;
    const useVector = opts.useVector !== false;

    let notebook = await this.deps.getNotebook(notebookId);
    if (!notebook) throw new Error(`notebook not found: ${notebookId}`);

    const versionStale =
      notebook.lastIndexVersion === undefined || notebook.lastIndexVersion < CHUNKING_VERSION;
    const hasAnyScopePaths = [...this.deps.pathMap.allAlivePaths()].some(p =>
      matchesNotebookScope(p, notebook!)
    );
    // Fire-and-forget reindex when the notebook is dirty or version-stale.
    // Previously we awaited this, which on large vaults blocks every search
    // for minutes (scan + parse + embed). Returning results from the existing
    // index immediately keeps the UI responsive; the reindex runs in the
    // background and the next query will see the updated index.
    if ((notebook.status === 'dirty' || (versionStale && hasAnyScopePaths)) && !staleOk) {
      void this.deps.reindex(notebookId).catch(() => { /* surfaces via eventBus */ });
    }

    await this.deps.ensureBM25ForNotebook(notebookId);
    const bm25 = this.deps.getBM25(notebookId);

    // ── Parallel: BM25 + vector ────────────────────────────────────────────
    const bm25Promise = Promise.resolve(bm25.search(query).slice(0, candidateK));

    let vecHits: Array<{ chunkId: string; score: number }> = [];
    const embClient = this.deps.embeddingRegistry?.get();

    if (useVector && embClient && this.deps.getVectorStore) {
      const vecSignal = AbortSignal.timeout(5000);
      try {
        const queryVec = await embClient.embedQuery(query, { signal: vecSignal });

        const vs = this.deps.getVectorStore(notebookId);
        if (!vs.isReady()) {
          await vs.load(notebookId, this.deps.hashCache, this.deps.pathMap, embClient.modelId, notebook, vecSignal);
        }
        vecHits = vs.search(new Float32Array(queryVec), candidateK);
      } catch (e) {
        // degraded — warn and continue BM25-only
        const reason = e instanceof Error ? e.message : String(e);
        console.warn(`SearchService: vector path failed (${reason}), falling back to BM25`);
      }
    }

    const rawBm25 = await bm25Promise;

    // ── RRF merge ────────────────────────────────────────────────────────────
    let candidates: SearchHit[];

    if (vecHits.length === 0) {
      // BM25-only path (no RRF)
      candidates = [];
      for (const h of rawBm25) {
        const [hashPart] = String(h.id).split(':');
        const entry = this.deps.hashCache.get(hashPart);
        if (!entry) continue;
        const chunk = entry.chunks.find(c => c.id === h.id);
        if (!chunk) continue;
        if (opts.filter && !opts.filter(chunk)) continue;
        const displayChunk = this.withDisplayPath(chunk, notebook);
        candidates.push({ chunk: displayChunk, bm25Score: h.score, finalRank: candidates.length });
      }
    } else {
      // Hybrid path: RRF merge
      const bm25RankMap = new Map<string, number>();
      rawBm25.forEach((h, i) => bm25RankMap.set(String(h.id), i + 1));

      const vecRankMap = new Map<string, number>();
      vecHits.forEach((h, i) => vecRankMap.set(h.chunkId, i + 1));

      const allChunkIds = new Set([...bm25RankMap.keys(), ...vecRankMap.keys()]);
      const scored: Array<{ chunkId: string; rrfScore: number; bm25Score?: number; vectorScore?: number }> = [];

      for (const chunkId of allChunkIds) {
        const rb = bm25RankMap.get(chunkId);
        const rv = vecRankMap.get(chunkId);
        const rrfScore = (rb ? 1 / (RRF_K + rb) : 0) + (rv ? 1 / (RRF_K + rv) : 0);
        const bm25Hit = rawBm25.find(h => String(h.id) === chunkId);
        const vecHit = vecHits.find(h => h.chunkId === chunkId);
        scored.push({
          chunkId, rrfScore,
          bm25Score: bm25Hit?.score,
          vectorScore: vecHit?.score,
        });
      }

      scored.sort((a, b) => b.rrfScore - a.rrfScore);

      candidates = [];
      for (const s of scored) {
        const [hashPart] = s.chunkId.split(':');
        const entry = this.deps.hashCache.get(hashPart);
        if (!entry) continue;
        const chunk = entry.chunks.find(c => c.id === s.chunkId);
        if (!chunk) continue;
        if (opts.filter && !opts.filter(chunk)) continue;
        const displayChunk = this.withDisplayPath(chunk, notebook);
        candidates.push({
          chunk: displayChunk,
          bm25Score: s.bm25Score,
          vectorScore: s.vectorScore,
          rrfScore: s.rrfScore,
          finalRank: candidates.length,
        });
      }
    }

    // ── Rerank ───────────────────────────────────────────────────────────────
    if (!rerank || candidates.length === 0) {
      return candidates.slice(0, topK).map((c, i) => ({ ...c, finalRank: i }));
    }

    const rerankerName = this.deps.resolveRerankerName();
    const reranker = rerankerName ? this.deps.rerankers.get(rerankerName) : undefined;
    if (!reranker) {
      return candidates.slice(0, topK).map((c, i) => ({ ...c, finalRank: i }));
    }

    const rerankInput = candidates.slice(0, Math.min(topK * 2, candidates.length));
    const reranked = await reranker.rerank(query, rerankInput);
    return reranked.slice(0, topK).map((h, i) => ({ ...h, finalRank: i }));
  }

  private withDisplayPath(chunk: Chunk, notebook: Notebook): Chunk {
    const pm = this.deps.pathMap;
    const current = pm.get(chunk.filePath);
    if (current && current.fileHash === chunk.fileHash && matchesNotebookScope(chunk.filePath, notebook)) {
      return chunk;
    }
    const alive = pm.alivePathsFor(chunk.fileHash)
      .filter(p => matchesNotebookScope(p, notebook))
      .slice()
      .sort();
    if (alive.length > 0) return { ...chunk, filePath: alive[0] };
    return chunk;
  }
}
