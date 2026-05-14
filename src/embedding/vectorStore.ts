import type { NotebookId, Notebook } from 'src/types/data';
import type { HashCacheStore } from 'src/indexer/hashCache';
import type { PathMapStore } from 'src/indexer/pathMap';
import { matchesNotebookScope } from 'src/indexer/scope';

interface VectorEntry {
  chunkId: string;
  vector: Float32Array;
}

const YIELD_EVERY = 500;
const WARN_SIZE = 100_000;

export class VectorStore {
  private index: VectorEntry[] = [];
  private ready = false;

  async load(
    notebookId: NotebookId,
    hashCache: HashCacheStore,
    pathMap: PathMapStore,
    currentModelId: string,
    notebook: Notebook,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    this.index = [];
    this.ready = false;

    let count = 0;
    const seenHashes = new Set<string>();

    for (const entry of pathMap.allAliveEntries()) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (!matchesNotebookScope(entry.filePath, notebook)) continue;
      if (seenHashes.has(entry.fileHash)) continue;
      seenHashes.add(entry.fileHash);

      const hce = hashCache.get(entry.fileHash);
      if (!hce || hce.embeddingModelId !== currentModelId || !hce.embeddings) continue;

      for (const [chunkId, vec] of Object.entries(hce.embeddings)) {
        this.index.push({ chunkId, vector: new Float32Array(vec) });
        count++;
        if (count % YIELD_EVERY === 0) {
          await new Promise<void>(res => setTimeout(res, 0));
          if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        }
      }
    }

    if (this.index.length > WARN_SIZE) {
      console.warn(`VectorStore: ${this.index.length} vectors loaded — consider HNSW upgrade`);
    }

    this.ready = true;
  }

  search(queryVec: Float32Array, topK: number): Array<{ chunkId: string; score: number }> {
    if (!this.ready || this.index.length === 0) return [];

    const scores: Array<{ chunkId: string; score: number }> = [];
    for (const entry of this.index) {
      let dot = 0;
      const v = entry.vector;
      for (let i = 0; i < v.length; i++) dot += v[i] * queryVec[i];
      scores.push({ chunkId: entry.chunkId, score: dot });
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  isReady(): boolean { return this.ready; }

  clear(): void {
    this.index = [];
    this.ready = false;
  }
}
