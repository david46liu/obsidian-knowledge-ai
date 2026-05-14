import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebWorkerHost } from '../WebWorkerHost';
import { WorkerHostError } from '../types';
import type { WorkerInbound, WorkerOutbound } from '../protocol';

// Node test env doesn't have ErrorEvent — provide a minimal polyfill
if (typeof ErrorEvent === 'undefined') {
  // @ts-expect-error polyfill for Node.js test environment
  globalThis.ErrorEvent = class ErrorEvent extends Event {
    readonly message: string;
    constructor(type: string, init?: { message?: string }) {
      super(type);
      this.message = init?.message ?? '';
    }
  };
}

class MockWorker {
  onmessage: ((evt: MessageEvent<WorkerOutbound>) => void) | null = null;
  onerror: ((evt: ErrorEvent) => void) | null = null;
  postedMessages: WorkerInbound[] = [];
  terminated = false;
  postMessage(msg: WorkerInbound, _transfer?: ArrayBuffer[]) { this.postedMessages.push(msg); }
  terminate() { this.terminated = true; }
  reply(msg: WorkerOutbound) { this.onmessage?.({ data: msg } as MessageEvent<WorkerOutbound>); }
  crash() { this.onerror?.(new ErrorEvent('error', { message: 'boom' })); }
}

describe('WebWorkerHost', () => {
  let workerInstances: MockWorker[];
  let factory: () => Worker;

  beforeEach(() => {
    workerInstances = [];
    // Cast at the boundary, not at every site
    factory = (() => { const w = new MockWorker(); workerInstances.push(w); return w; }) as unknown as () => Worker;
  });

  it('成功路径:postMessage extract → 收到 ok 消息 → resolve', async () => {
    const host = new WebWorkerHost({ factory, timeoutMs: 1000 });
    const buf = new ArrayBuffer(4);
    const promise = host.extract({ ext: 'md', buffer: buf, opts: {} });
    expect(workerInstances.length).toBe(1);
    const w = workerInstances[0];
    expect(w.postedMessages.length).toBe(1);
    const sent = w.postedMessages[0];
    if (sent.type !== 'extract') throw new Error('expected extract');
    expect(sent.type).toBe('extract');
    w.reply({ id: sent.id, type: 'ok', hash: 'abc', markdown: '#x', locatorMap: [] });
    const out = await promise;
    expect(out.hash).toBe('abc');
  });

  it('parse 错回包 → 抛 WorkerHostError(parse)', async () => {
    const host = new WebWorkerHost({ factory, timeoutMs: 1000 });
    const promise = host.extract({ ext: 'docx', buffer: new ArrayBuffer(4), opts: {} });
    const w = workerInstances[0];
    const sent = w.postedMessages[0];
    if (sent.type !== 'extract') throw new Error('expected extract');
    w.reply({ id: sent.id, type: 'error', errorClass: 'parse', message: 'bad zip' });
    const err = await promise.catch(e => e);
    expect(err).toBeInstanceOf(WorkerHostError);
    expect(err.errorClass).toBe('parse');
  });

  it('60s 内无回复 → timeout,terminate + respawn,errorClass=timeout', async () => {
    vi.useFakeTimers();
    const host = new WebWorkerHost({ factory, timeoutMs: 50 });
    const promise = host.extract({ ext: 'pptx', buffer: new ArrayBuffer(4), opts: {} });
    vi.advanceTimersByTime(60);
    const err = await promise.catch(e => e);
    expect(err).toBeInstanceOf(WorkerHostError);
    expect(err.errorClass).toBe('timeout');
    expect(workerInstances[0].terminated).toBe(true);
    vi.useRealTimers();
  });

  it('worker crash → errorClass=worker-crash,respawn 后续可继续', async () => {
    const host = new WebWorkerHost({ factory, timeoutMs: 1000 });
    const p1 = host.extract({ ext: 'docx', buffer: new ArrayBuffer(4), opts: {} });
    workerInstances[0].crash();
    const err = await p1.catch(e => e);
    expect(err).toBeInstanceOf(WorkerHostError);
    expect(err.errorClass).toBe('worker-crash');
    const p2 = host.extract({ ext: 'docx', buffer: new ArrayBuffer(4), opts: {} });
    expect(workerInstances.length).toBe(2);
    const w2 = workerInstances[1];
    const sent2 = w2.postedMessages[0];
    if (sent2.type !== 'extract') throw new Error('expected extract');
    w2.reply({ id: sent2.id, type: 'ok', hash: 'h', markdown: '', locatorMap: [] });
    await expect(p2).resolves.toMatchObject({ hash: 'h' });
  });

  it('AbortSignal 已 abort → 立即 reject,不发 postMessage,worker 不被 terminate', async () => {
    const host = new WebWorkerHost({ factory, timeoutMs: 1000 });
    const ac = new AbortController();
    ac.abort();
    await expect(host.extract({ ext: 'md', buffer: new ArrayBuffer(4), opts: {} }, ac.signal))
      .rejects.toThrow(/abort/i);
    expect(workerInstances[0].terminated).toBe(false);
    expect(workerInstances[0].postedMessages.length).toBe(0);
  });

  it('extract 中途 abort → reject,但 worker 不被 terminate', async () => {
    const host = new WebWorkerHost({ factory, timeoutMs: 1000 });
    const ac = new AbortController();
    const promise = host.extract({ ext: 'md', buffer: new ArrayBuffer(4), opts: {} }, ac.signal);
    ac.abort();
    await expect(promise).rejects.toThrow(/abort/i);
    expect(workerInstances[0].terminated).toBe(false);
  });

  it('shutdown 后 terminate worker,后续 extract 拒绝', async () => {
    const host = new WebWorkerHost({ factory, timeoutMs: 1000 });
    // 发两个 extract,都不回复 → 都在 pending
    const p1 = host.extract({ ext: 'md', buffer: new ArrayBuffer(4), opts: {} });
    const p2 = host.extract({ ext: 'md', buffer: new ArrayBuffer(4), opts: {} });
    // shutdown 应同时 terminate worker 并拒绝所有 pending
    await host.shutdown();
    expect(workerInstances[0].terminated).toBe(true);
    const [e1, e2] = await Promise.all([p1.catch(e => e), p2.catch(e => e)]);
    expect(e1).toBeInstanceOf(WorkerHostError);
    expect((e1 as WorkerHostError).errorClass).toBe('worker-crash');
    expect(e2).toBeInstanceOf(WorkerHostError);
    // 后续 extract 拒绝
    await expect(host.extract({ ext: 'md', buffer: new ArrayBuffer(4), opts: {} }))
      .rejects.toThrow(/shutdown/i);
  });
});
