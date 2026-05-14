import { Vault, TFile } from 'obsidian';
import type { IVaultAdapter, VaultFile, VaultStat, VaultEventPayload } from './types';

export class VaultAdapter implements IVaultAdapter {
  constructor(private readonly vault: Vault) {}

  async getMarkdownFiles(): Promise<VaultFile[]> {
    return this.getFiles({ extensions: ['md'] });
  }

  async getFiles({ extensions }: { extensions: string[] }): Promise<VaultFile[]> {
    const set = new Set(extensions.map(e => e.toLowerCase()));
    return this.vault.getFiles()
      // Obsidian TFile.extension 不含前导点(API 契约);extensions 参数也不含点,直接比较
      .filter(f => set.has(f.extension.toLowerCase()))
      .map(f => ({ path: f.path, stat: { mtime: f.stat.mtime, size: f.stat.size } }));
  }

  async read(path: string): Promise<string> {
    const file = this.vault.getFileByPath(path);
    if (!file || !(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    return this.vault.read(file);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.vault.getFileByPath(path);
    if (!file || !(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    return this.vault.readBinary(file);
  }

  async stat(path: string): Promise<VaultStat | null> {
    const file = this.vault.getFileByPath(path);
    if (!file || !(file instanceof TFile)) return null;
    return { mtime: file.stat.mtime, size: file.stat.size };
  }

  on(listener: (payload: VaultEventPayload) => void): () => void {
    const offModify = this.vault.on('modify',  f => listener({ type: 'modify', path: f.path }));
    const offCreate = this.vault.on('create',  f => listener({ type: 'create', path: f.path }));
    const offDelete = this.vault.on('delete',  f => listener({ type: 'delete', path: f.path }));
    const offRename = this.vault.on('rename',  (f, oldPath) =>
      listener({ type: 'rename', path: f.path, oldPath })
    );
    return () => {
      this.vault.offref(offModify); this.vault.offref(offCreate);
      this.vault.offref(offDelete); this.vault.offref(offRename);
    };
  }
}
