export interface LaneSchedulerConfig {
  fastConcurrency: number;
  slowConcurrency: number;
  /** ext → 字节阈值;>= 阈值走 slow lane */
  softLimits: Record<string, number>;
}

class Semaphore {
  private current = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly capacity: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.capacity) { this.current++; return; }
    // Slot will be transferred directly to us by release(); don't increment after wakeup.
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Direct handoff — slot transferred without dec/inc roundtrip
      next();
    } else {
      this.current--;
    }
  }
}

export class LaneScheduler {
  private readonly fast: Semaphore;
  private readonly slow: Semaphore;
  private readonly softLimits: Record<string, number>;

  constructor(cfg: LaneSchedulerConfig) {
    this.fast = new Semaphore(cfg.fastConcurrency);
    this.slow = new Semaphore(cfg.slowConcurrency);
    this.softLimits = cfg.softLimits;
  }

  async run<T>(size: number, ext: string, fn: () => Promise<T>): Promise<T> {
    const limit = this.softLimits[ext];
    const lane = (limit !== undefined && size >= limit) ? this.slow : this.fast;
    await lane.acquire();
    try {
      return await fn();
    } finally {
      lane.release();
    }
  }
}
