import type { EmbedRequest, EmbedResponse } from './embeddingProtocol';

interface PendingCall {
  resolve(v: number[][]): void;
  reject(e: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

export interface EmbeddingWorkerHostConfig {
  factory: () => Worker;
  timeoutMs?: number;
  onProgress?: (pct: number) => void;
}

export class EmbeddingWorkerHost {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private shuttingDown = false;
  private readonly timeoutMs: number;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly cfg: EmbeddingWorkerHostConfig) {
    this.timeoutMs = cfg.timeoutMs ?? 60_000;
  }

  async init(modelId: string, cacheDir: string, wasmBytes?: Record<string, ArrayBuffer>): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit(modelId, cacheDir, wasmBytes);
    return this.initPromise;
  }

  private async doInit(modelId: string, cacheDir: string, wasmBytes?: Record<string, ArrayBuffer>): Promise<void> {
    this.spawn();
    return new Promise<void>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('EmbeddingWorkerHost init timeout'));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
        timer,
      });

      const msg: EmbedRequest = { id, type: 'init', modelId, cacheDir, wasmBytes };
      const transfer = wasmBytes ? Object.values(wasmBytes) : [];
      this.worker!.postMessage(msg, transfer);
    });
  }

  async embed(opts: {
    texts: string[];
    type: 'document' | 'query';
    signal?: AbortSignal;
  }): Promise<number[][]> {
    if (this.shuttingDown) throw new Error('EmbeddingWorkerHost shutdown');
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (!this.worker) this.spawn();

    const id = this.nextId++;
    return new Promise<number[][]>((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (!p) return;
        p.signal?.removeEventListener('abort', p.abortHandler!);
        this.pending.delete(id);
        this.respawn();
        reject(new Error('embedding timeout'));
      }, this.timeoutMs);

      const abortHandler = () => {
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        p.signal?.removeEventListener('abort', p.abortHandler!);
        this.pending.delete(id);
        reject(new DOMException('aborted', 'AbortError'));
      };
      opts.signal?.addEventListener('abort', abortHandler);

      this.pending.set(id, { resolve, reject, timer, signal: opts.signal, abortHandler });

      const msg: EmbedRequest = {
        id, type: 'embed', texts: opts.texts, embedType: opts.type,
      };
      this.worker!.postMessage(msg);
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.signal?.removeEventListener('abort', p.abortHandler!);
      p.reject(new Error('EmbeddingWorkerHost shutdown'));
    }
    this.pending.clear();
  }

  private spawn(): void {
    this.worker = this.cfg.factory();
    this.worker.onmessage = (evt: MessageEvent<EmbedResponse>) => this.handleMessage(evt.data);
    this.worker.onerror = (evt: ErrorEvent) => this.handleCrash(evt.message || 'worker error');
  }

  private respawn(): void {
    this.worker?.terminate();
    this.worker = null;
    this.initPromise = null;
    if (!this.shuttingDown) this.spawn();
  }

  private handleMessage(msg: EmbedResponse): void {
    if (msg.type === 'progress') {
      this.cfg.onProgress?.(msg.pct ?? 0);
      return;
    }
    // Worker-level setup / uncaught diagnostics (id < 0). Not tied to a
    // pending call — log to console so crashes during module load are
    // visible instead of arriving as opaque ErrorEvents via onerror.
    if (msg.id < 0) {
      console.warn('[embedding worker]', msg.error ?? msg);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    p.signal?.removeEventListener('abort', p.abortHandler!);
    this.pending.delete(msg.id);

    if (msg.type === 'ready') {
      (p.resolve as () => void)();
    } else if (msg.type === 'vectors') {
      p.resolve(msg.vectors!);
    } else {
      p.reject(new Error(msg.error ?? 'unknown worker error'));
    }
  }

  private handleCrash(message: string): void {
    const inflight = [...this.pending.values()];
    this.pending.clear();
    for (const p of inflight) {
      clearTimeout(p.timer);
      p.signal?.removeEventListener('abort', p.abortHandler!);
      p.reject(new Error(message));
    }
    this.respawn();
  }
}
