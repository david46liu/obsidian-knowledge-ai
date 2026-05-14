import { promises as fs } from 'fs';
import { resolve, dirname } from 'path';
import type { IDataStoreAdapter } from './types';

/**
 * 桌面端实现:直接操作 Node.js fs。
 * pluginAbsDir = app.vault.adapter.getBasePath() + '/' + plugin.manifest.dir
 */
export class DataStoreAdapter implements IDataStoreAdapter {
  constructor(private readonly pluginAbsDir: string) {}

  private abs(relative: string): string {
    return resolve(this.pluginAbsDir, relative);
  }

  async read(path: string): Promise<string | null> {
    try {
      return await fs.readFile(this.abs(path), 'utf8');
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async writeAtomic(path: string, content: string): Promise<void> {
    const target = this.abs(path);
    const tmp = `${target}.tmp`;
    await fs.mkdir(dirname(target), { recursive: true });
    const fh = await fs.open(tmp, 'w');
    try {
      await fh.writeFile(content, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, target);
  }

  async append(path: string, content: string): Promise<void> {
    const target = this.abs(path);
    await fs.mkdir(dirname(target), { recursive: true });
    const fh = await fs.open(target, 'a');
    try {
      await fh.appendFile(content, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(this.abs(oldPath), this.abs(newPath));
  }

  async remove(path: string): Promise<void> {
    try {
      await fs.unlink(this.abs(path));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }

  async list(dirPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.abs(dirPath), { withFileTypes: true });
      return entries.filter(e => e.isFile()).map(e => e.name);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async mkdir(path: string): Promise<void> {
    await fs.mkdir(this.abs(path), { recursive: true });
  }
}
