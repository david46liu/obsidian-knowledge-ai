import type { WorkerInbound, WorkerOutbound } from './protocol';
import { WORKER_DEFAULT_TIMEOUT_MS } from './protocol';
import type { ExtractRequest, ExtractResponse, IWorkerHost } from './types';
import { WorkerHostError } from './types';

interface PendingCall {
  resolve(r: ExtractResponse): void;
  reject(e: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

export interface WebWorkerHostConfig {
  factory: () => Worker;
  timeoutMs?: number;
}

export class WebWorkerHost implements IWorkerHost {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private shuttingDown = false;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: WebWorkerHostConfig) {
    this.timeoutMs = cfg.timeoutMs ?? WORKER_DEFAULT_TIMEOUT_MS;
    this.spawn();
  }

  async extract(req: ExtractRequest, signal?: AbortSignal): Promise<ExtractResponse> {
    if (this.shuttingDown) throw new WorkerHostError('worker host shutdown', 'worker-crash');
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (!this.worker) this.spawn();

    const id = this.nextId++;
    return new Promise<ExtractResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (!p) return;
        // Clean up abort listener before deleting from pending
        p.signal?.removeEventListener('abort', p.abortHandler!);
        this.pending.delete(id);
        this.respawn();   // stuck worker → terminate + new
        reject(new WorkerHostError('extraction timeout', 'timeout'));
      }, this.timeoutMs);

      const abortHandler = () => {
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        // Do NOT terminate worker — D semantics
        reject(new DOMException('aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abortHandler);

      this.pending.set(id, { resolve, reject, timer, signal, abortHandler });

      const msg: WorkerInbound = {
        id, type: 'extract', ext: req.ext, buffer: req.buffer, opts: req.opts,
      };
      this.worker!.postMessage(msg, [req.buffer]);
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.signal?.removeEventListener('abort', p.abortHandler!);
      p.reject(new WorkerHostError('worker host shutdown', 'worker-crash'));
    }
    this.pending.clear();
  }

  private spawn() {
    this.worker = this.cfg.factory();
    this.worker.onmessage = (evt: MessageEvent<WorkerOutbound>) => this.handleMessage(evt.data);
    this.worker.onerror = (evt: ErrorEvent) => this.handleCrash(evt.message || 'worker error');
  }

  private respawn() {
    this.worker?.terminate();
    this.worker = null;
    if (!this.shuttingDown) this.spawn();
  }

  private handleMessage(msg: WorkerOutbound): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    p.signal?.removeEventListener('abort', p.abortHandler!);
    this.pending.delete(msg.id);

    if (msg.type === 'ok') {
      p.resolve({ hash: msg.hash, markdown: msg.markdown, locatorMap: msg.locatorMap as ExtractResponse['locatorMap'] });
    } else {
      p.reject(new WorkerHostError(msg.message, msg.errorClass));
    }
  }

  private handleCrash(message: string): void {
    const inflight = [...this.pending.values()];
    this.pending.clear();
    for (const p of inflight) {
      clearTimeout(p.timer);
      p.signal?.removeEventListener('abort', p.abortHandler!);
      p.reject(new WorkerHostError(message, 'worker-crash'));
    }
    this.respawn();
  }
}
