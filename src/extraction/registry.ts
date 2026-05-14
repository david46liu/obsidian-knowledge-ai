import type { Extractor } from './types';

type Loader = () => Promise<Extractor>;

export class ExtractorRegistry {
  private readonly loaders = new Map<string, Loader>();
  private readonly cache = new Map<string, Extractor>();
  private readonly inflight = new Map<string, Promise<Extractor>>();

  register(extensions: string[], loader: Loader): void {
    for (const ext of extensions) {
      this.loaders.set(ext.toLowerCase(), loader);
    }
  }

  has(ext: string): boolean {
    return this.loaders.has(ext.toLowerCase());
  }

  /**
   * 懒加载 + 并发安全:首次访问触发 loader,加载中的并发调用共享同一 Promise,
   * 完成后写 cache、清 inflight。后续命中 cache。
   */
  async get(ext: string): Promise<Extractor | undefined> {
    const key = ext.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    const loader = this.loaders.get(key);
    if (!loader) return undefined;

    let promise = this.inflight.get(key);
    if (!promise) {
      promise = loader().then(extractor => {
        this.cache.set(key, extractor);
        this.inflight.delete(key);
        return extractor;
      });
      this.inflight.set(key, promise);
    }
    return promise;
  }

  /** 仅查 cache,不触发 loader;未加载过返回 undefined。供同步上下文使用。 */
  syncGet(ext: string): Extractor | undefined {
    return this.cache.get(ext.toLowerCase());
  }

  knownExtensions(): string[] {
    return [...this.loaders.keys()];
  }
}
