import { describe, it, expect } from 'vitest';
import { InProcessWorkerHost } from '../InProcessWorkerHost';
import { ExtractorRegistry } from 'src/extraction/registry';
import { markdownExtractor } from 'src/extraction/markdown';
import { WorkerHostError } from '../types';

const hashFn = async (bytes: Uint8Array) => `h-${bytes.byteLength}`;

function makeHost() {
  const reg = new ExtractorRegistry();
  reg.register(['md', 'txt'], async () => markdownExtractor);
  return new InProcessWorkerHost({ registry: reg, hashFn });
}

describe('InProcessWorkerHost', () => {
  it('md passthrough — 返回 hash + markdown + 空 locatorMap', async () => {
    const host = makeHost();
    const buf = new TextEncoder().encode('# title\n\nbody').buffer;
    const out = await host.extract({ ext: 'md', buffer: buf, opts: {} });
    expect(out.markdown).toMatch(/title/);
    expect(out.hash).toBe('h-13');
    expect(out.locatorMap).toEqual([]);
  });

  it('未注册扩展名抛 WorkerHostError(parse)', async () => {
    const host = makeHost();
    await expect(host.extract({ ext: 'xyz', buffer: new ArrayBuffer(4), opts: {} }))
      .rejects.toBeInstanceOf(WorkerHostError);
  });

  it('已 abort 的 signal 立即抛 AbortError', async () => {
    const host = makeHost();
    const ac = new AbortController();
    ac.abort();
    await expect(host.extract({ ext: 'md', buffer: new ArrayBuffer(0), opts: {} }, ac.signal))
      .rejects.toThrow('aborted');
  });

  it('extractor 抛 non-Abort Error → 包装为 WorkerHostError(parse)', async () => {
    const reg = new ExtractorRegistry();
    reg.register(['bad'], async () => ({
      extensions: ['bad'] as const,
      version: 1,
      async extract() { throw new Error('boom'); },
    }));
    const host = new InProcessWorkerHost({ registry: reg, hashFn });
    await expect(host.extract({ ext: 'bad', buffer: new ArrayBuffer(4), opts: {} }))
      .rejects.toMatchObject({
        name: 'WorkerHostError',
        errorClass: 'parse',
        message: 'boom',
      });
  });
});
