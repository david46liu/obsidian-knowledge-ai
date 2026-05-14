import type { IDataStoreAdapter } from 'src/adapters/types';
import type { StoragePaths } from 'src/storage/paths';
import type { PathMapEntry } from 'src/types/data';
import { appendJsonl, readJsonl } from 'src/storage/jsonl';

export class PathMapStore {
  private readonly alive = new Map<string, PathMapEntry>();
  /** 反向索引:fileHash → set of alive filePaths。与 alive 保持同步。 */
  private readonly byHash = new Map<string, Set<string>>();

  constructor(
    private readonly adapter: IDataStoreAdapter,
    private readonly paths: StoragePaths
  ) {}

  async load(): Promise<void> {
    this.alive.clear();
    this.byHash.clear();
    const lines = await readJsonl<PathMapEntry>(this.adapter, this.paths.pathsJsonl);
    for (const line of lines) this.apply(line);
  }

  get(path: string): PathMapEntry | undefined {
    return this.alive.get(path);
  }

  has(path: string): boolean {
    return this.alive.has(path);
  }

  alivePathsFor(hash: string): string[] {
    return [...(this.byHash.get(hash) ?? [])];
  }

  *allAlivePaths(): IterableIterator<string> {
    yield* this.alive.keys();
  }

  *allAliveEntries(): IterableIterator<PathMapEntry> {
    yield* this.alive.values();
  }

  async append(entry: PathMapEntry): Promise<void> {
    await appendJsonl(this.adapter, this.paths.pathsJsonl, entry);
    this.apply(entry);
  }

  replaceAll(entries: Iterable<PathMapEntry>): void {
    this.alive.clear();
    this.byHash.clear();
    for (const e of entries) this.apply(e);
  }

  private apply(entry: PathMapEntry): void {
    const prev = this.alive.get(entry.filePath);
    if (prev) {
      this.byHash.get(prev.fileHash)?.delete(entry.filePath);
    }

    if (entry.tombstone) {
      this.alive.delete(entry.filePath);
    } else {
      this.alive.set(entry.filePath, entry);
      let set = this.byHash.get(entry.fileHash);
      if (!set) { set = new Set(); this.byHash.set(entry.fileHash, set); }
      set.add(entry.filePath);
    }
  }
}
