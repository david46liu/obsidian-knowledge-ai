import { IDataStoreAdapter } from 'src/adapters/types';

/**
 * 纯内存实现,供 storage/ 层单测使用。
 * rename/mkdir 为 best-effort;不模拟 fsync。
 */
export class InMemoryDataStoreAdapter implements IDataStoreAdapter {
  private fs = new Map<string, string>();

  async read(path: string): Promise<string | null> {
    return this.fs.get(this.norm(path)) ?? null;
  }

  async writeAtomic(path: string, content: string): Promise<void> {
    this.fs.set(this.norm(path), content);
  }

  async append(path: string, content: string): Promise<void> {
    const key = this.norm(path);
    this.fs.set(key, (this.fs.get(key) ?? '') + content);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const src = this.norm(oldPath);
    const dst = this.norm(newPath);
    const data = this.fs.get(src);
    if (data !== undefined) {
      this.fs.set(dst, data);
      this.fs.delete(src);
    }
  }

  async remove(path: string): Promise<void> {
    this.fs.delete(this.norm(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.fs.has(this.norm(path));
  }

  async list(dirPath: string): Promise<string[]> {
    const prefix = this.norm(dirPath) + '/';
    return [...this.fs.keys()]
      .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map(k => k.slice(prefix.length));
  }

  async mkdir(_path: string): Promise<void> {
    // 内存里无需实际创建目录
  }

  /** 暴露给测试直接查看内部 */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.fs);
  }

  private norm(p: string): string {
    return p.replace(/\\/g, '/');
  }
}
