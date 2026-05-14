import type { IVaultAdapter, VaultFile, VaultStat, VaultEventPayload } from 'src/adapters/types';

interface InMemoryFile {
  bytes: Uint8Array;
  mtime: number;
}

export class InMemoryVaultAdapter implements IVaultAdapter {
  private files = new Map<string, InMemoryFile>();
  private listeners = new Set<(payload: VaultEventPayload) => void>();
  private statOverrides = new Map<string, VaultStat>();

  // ── 测试辅助 ────────────────────────────────────────────────

  setStat(path: string, stat: VaultStat): void {
    this.statOverrides.set(path, stat);
  }

  writeFile(path: string, content: string, mtime = Date.now()): void {
    this.writeBinary(path, new TextEncoder().encode(content), mtime);
  }

  writeBinary(path: string, bytes: Uint8Array, mtime = Date.now()): void {
    const isNew = !this.files.has(path);
    this.files.set(path, { bytes, mtime });
    this.dispatch({ type: isNew ? 'create' : 'modify', path });
  }

  deleteFile(path: string): void {
    this.files.delete(path);
    this.dispatch({ type: 'delete', path });
  }

  renameFile(oldPath: string, newPath: string, mtime = Date.now()): void {
    const file = this.files.get(oldPath);
    if (!file) return;
    this.files.set(newPath, { bytes: file.bytes, mtime });
    this.files.delete(oldPath);
    this.dispatch({ type: 'rename', path: newPath, oldPath });
  }

  // ── IVaultAdapter ──────────────────────────────────────────

  async getMarkdownFiles(): Promise<VaultFile[]> {
    return this.getFiles({ extensions: ['md'] });
  }

  async getFiles({ extensions }: { extensions: string[] }): Promise<VaultFile[]> {
    const set = new Set(extensions.map(e => e.toLowerCase()));
    return [...this.files.entries()]
      .filter(([p]) => {
        const ext = p.split('.').pop()?.toLowerCase();
        return ext !== undefined && set.has(ext);
      })
      .map(([path, { mtime, bytes }]) => {
        const override = this.statOverrides.get(path);
        return {
          path,
          stat: override ?? { mtime, size: bytes.byteLength },
        };
      });
  }

  async read(path: string): Promise<string> {
    const f = this.files.get(path);
    if (!f) throw new Error(`InMemoryVaultAdapter: file not found: ${path}`);
    return new TextDecoder('utf-8').decode(f.bytes);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const f = this.files.get(path);
    if (!f) throw new Error(`InMemoryVaultAdapter: file not found: ${path}`);
    return f.bytes.slice().buffer;
  }

  async stat(path: string): Promise<VaultStat | null> {
    const override = this.statOverrides.get(path);
    if (override) return override;
    const f = this.files.get(path);
    if (!f) return null;
    return { mtime: f.mtime, size: f.bytes.byteLength };
  }

  on(listener: (payload: VaultEventPayload) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private dispatch(payload: VaultEventPayload): void {
    this.listeners.forEach(fn => fn(payload));
  }
}
