import type { IDataStoreAdapter } from 'src/adapters/types';
import type { StoragePaths } from 'src/storage/paths';
import type { HashCacheEntry } from 'src/types/data';
import { appendJsonl, readJsonl } from 'src/storage/jsonl';

/**
 * Hash 主键的内存 Map + JSONL 持久化。
 * 读:从 hashes.jsonl 按顺序读入,同 fileHash 后写覆盖先写;tombstone 可复活。
 * 写:仅 append(物理压实由 compaction 模块负责)。
 */
export class HashCacheStore {
  private readonly alive = new Map<string, HashCacheEntry>();
  private readonly raw = new Map<string, HashCacheEntry>();

  constructor(
    private readonly adapter: IDataStoreAdapter,
    private readonly paths: StoragePaths
  ) {}

  async load(): Promise<void> {
    this.alive.clear();
    this.raw.clear();
    const lines = await readJsonl<HashCacheEntry>(this.adapter, this.paths.hashesJsonl);
    for (const line of lines) this.apply(line);
  }

  get(hash: string): HashCacheEntry | undefined {
    return this.alive.get(hash);
  }

  getRaw(hash: string): HashCacheEntry | undefined {
    return this.raw.get(hash);
  }

  has(hash: string): boolean {
    return this.alive.has(hash);
  }

  async append(entry: HashCacheEntry): Promise<void> {
    await appendJsonl(this.adapter, this.paths.hashesJsonl, entry);
    this.apply(entry);
  }

  *aliveEntries(): IterableIterator<HashCacheEntry> {
    yield* this.alive.values();
  }

  invalidate(hash: string): void {
    this.alive.delete(hash);
    this.raw.delete(hash);
  }

  replaceAll(entries: Iterable<HashCacheEntry>): void {
    this.alive.clear();
    this.raw.clear();
    for (const e of entries) this.apply(e);
  }

  private apply(entry: HashCacheEntry): void {
    this.raw.set(entry.fileHash, entry);
    if (entry.tombstone) {
      this.alive.delete(entry.fileHash);
    } else {
      this.alive.set(entry.fileHash, entry);
    }
  }
}
