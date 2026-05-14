import MiniSearch from 'minisearch';
import type { IDataStoreAdapter } from 'src/adapters/types';
import type { StoragePaths } from 'src/storage/paths';
import type { Chunk, BM25Index, NotebookId } from 'src/types/data';
import { readJson, writeJson } from 'src/storage/json';
import { segmentWords } from 'src/chunking/tokenize';
import { INDEX_SCHEMA_VERSION } from 'src/retrieval/types';

export interface BM25SearchHit {
  id: string;
  score: number;
}

const tokenize = (s: string) => segmentWords(s);

/** 单 Notebook 的 BM25 索引(MiniSearch 包装)。 */
export class BM25Store {
  private ms: MiniSearch<BM25Doc>;

  constructor(
    private readonly adapter: IDataStoreAdapter,
    private readonly paths: StoragePaths,
    private readonly notebookId: NotebookId,
    private readonly chunkingVersion: number
  ) {
    this.ms = createMiniSearch();
  }

  add(chunks: Chunk[]): void {
    const docs = chunks.map(c => chunkToDoc(c));
    this.ms.addAll(docs);
  }

  discardByIds(ids: string[]): void {
    for (const id of ids) {
      try { this.ms.discard(id); } catch { /* id 不存在时忽略 */ }
    }
  }

  search(query: string): BM25SearchHit[] {
    const hits = this.ms.search(query, {
      fuzzy: 0.1,
      prefix: true,
      boost: { headingText: 2 },
      combineWith: 'OR',
    });
    return hits.map(h => ({ id: String(h.id), score: h.score }));
  }

  async persist(): Promise<void> {
    const payload: BM25Index = {
      notebookId: this.notebookId,
      miniSearchState: JSON.parse(JSON.stringify(this.ms.toJSON())),
      schemaVersion: INDEX_SCHEMA_VERSION,
      chunkingVersion: this.chunkingVersion,
    };
    await writeJson(this.adapter, this.paths.indexFile(this.notebookId), payload);
  }

  /** 加载并返回 true(成功且版本匹配);否则返回 false(由 IndexService 决定重建)。 */
  async load(): Promise<boolean> {
    const data = await readJson<BM25Index>(this.adapter, this.paths.indexFile(this.notebookId));
    if (!data) return false;
    if (data.schemaVersion !== INDEX_SCHEMA_VERSION) return false;
    if (data.chunkingVersion !== this.chunkingVersion) return false;

    this.ms = MiniSearch.loadJS(data.miniSearchState as never, miniSearchOptions());
    return true;
  }

  /** 清空索引(IndexService 在版本不匹配触发重建前调用)。 */
  clear(): void {
    this.ms = createMiniSearch();
  }
}

interface BM25Doc {
  id: string;
  headingText: string;
  content: string;
  path: string;
}

function chunkToDoc(c: Chunk): BM25Doc {
  return {
    id: c.id,
    headingText: c.headingText,
    content: c.content,
    path: c.filePath,
  };
}

function miniSearchOptions() {
  return {
    fields: ['headingText', 'content', 'path'],
    storeFields: ['id'],
    idField: 'id',
    tokenize,
    searchOptions: { tokenize },
  };
}

function createMiniSearch(): MiniSearch<BM25Doc> {
  return new MiniSearch<BM25Doc>(miniSearchOptions());
}
