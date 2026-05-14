// ── Vault Adapter (读取 vault 中的 markdown 文件) ──────────────────────────

export interface VaultStat {
  mtime: number;   // Unix ms
  size: number;    // bytes
}

export interface VaultFile {
  path: string;    // vault 相对路径
  stat: VaultStat;
}

export type VaultEventType = 'modify' | 'create' | 'delete' | 'rename';

export interface VaultRenamePayload {
  type: 'rename';
  path: string;    // 新路径
  oldPath: string;
}

export interface VaultChangePayload {
  type: 'modify' | 'create' | 'delete';
  path: string;
}

export type VaultEventPayload = VaultChangePayload | VaultRenamePayload;

export interface IVaultAdapter {
  /** @deprecated 用 getFiles({ extensions:['md'] }) 替代;保留为兼容旧测试 */
  getMarkdownFiles(): Promise<VaultFile[]>;
  /** 按扩展名白名单返回 vault 内文件;extensions 小写不含点 */
  getFiles(opts: { extensions: string[] }): Promise<VaultFile[]>;
  read(path: string): Promise<string>;
  /** 二进制读取;返回完整 ArrayBuffer(Obsidian API 限制,无 stream) */
  readBinary(path: string): Promise<ArrayBuffer>;
  stat(path: string): Promise<VaultStat | null>;
  on(listener: (payload: VaultEventPayload) => void): () => void;
}

// ── DataStore Adapter (插件数据目录的文件 IO) ──────────────────────────────

export interface IDataStoreAdapter {
  /** 读取文件内容;文件不存在返回 null */
  read(relativePath: string): Promise<string | null>;
  /** 写文件(tmp → fsync → rename 原子) */
  writeAtomic(relativePath: string, content: string): Promise<void>;
  /** 追加内容并 fsync */
  append(relativePath: string, content: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(relativePath: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  /** 列出目录下文件的相对路径(非递归) */
  list(relativePath: string): Promise<string[]>;
  mkdir(relativePath: string): Promise<void>;
}
