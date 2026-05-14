import { describe, it, expect, beforeAll } from 'vitest';
import { build } from 'esbuild';
import { Worker as NodeWorker } from 'node:worker_threads';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURES = join(__dirname, '..', '..', '__tests__', 'fixtures');

let bundlePath: string;

beforeAll(async () => {
  const result = await build({
    entryPoints: ['src/extraction/worker/extractor.worker.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2018',
    mainFields: ['browser', 'module', 'main'],
    write: false,
    external: [],
    tsconfig: 'tsconfig.json',
  });
  const bundleText = result.outputFiles[0].text;
  expect(bundleText.length).toBeGreaterThan(1000);

  // Inject minimal polyfill so the worker bundle's `self.addEventListener('message', ...)`
  // and `self.postMessage(...)` bridge to `parentPort`. Also expose `crypto.subtle`.
  const polyfill = `
const { parentPort } = require('node:worker_threads');
const _listeners = [];
globalThis.self = {
  addEventListener(type, fn) {
    if (type === 'message') {
      _listeners.push(fn);
      parentPort.on('message', (data) => fn({ data }));
    }
  },
  postMessage(msg) { parentPort.postMessage(msg); },
  crypto: { subtle: require('node:crypto').webcrypto.subtle },
};
`;

  // Wrap the bundle in an IIFE that shadows `Buffer` with undefined so the
  // browser-platform mammoth bundle takes the `{ arrayBuffer }` code path
  // (its Node-aware openZip was excluded by esbuild's mainFields:['browser',...]).
  const wrapped = `(function(Buffer) {\n${bundleText}\n})(undefined);`;

  const tmp = mkdtempSync(join(tmpdir(), 'worker-smoke-'));
  bundlePath = join(tmp, 'extractor.worker.cjs');
  writeFileSync(bundlePath, polyfill + wrapped);
}, 60_000);

async function rpc(ext: string, buffer: ArrayBuffer): Promise<any> {
  const worker = new NodeWorker(bundlePath);
  try {
    return await new Promise<any>((resolve, reject) => {
      // Some bundled libraries (e.g. asap/MessageChannel polyfill) emit a
      // spurious empty-string message during startup.  Only resolve on a
      // proper WorkerOutbound object (has numeric `id`).
      worker.on('message', (msg) => {
        if (msg && typeof msg === 'object' && typeof msg.id === 'number') resolve(msg);
      });
      worker.on('error', reject);
      worker.postMessage({ id: 1, type: 'extract', ext, buffer, opts: {} }, [buffer]);
    });
  } finally {
    await worker.terminate();
  }
}

describe('worker bundle smoke (real esbuild output)', () => {
  it('docx — mammoth 在 worker 上下文能装载', async () => {
    const buf = new Uint8Array(readFileSync(join(FIXTURES, 'simple.docx'))).buffer;
    const r = await rpc('docx', buf);
    expect(r.type).toBe('ok');
    expect(r.markdown.length).toBeGreaterThan(0);
    expect(r.hash.length).toBe(64);
  }, 60_000);

  it('xlsx — SheetJS 在 worker 上下文能装载', async () => {
    const buf = new Uint8Array(readFileSync(join(FIXTURES, 'single-sheet.xlsx'))).buffer;
    const r = await rpc('xlsx', buf);
    expect(r.type).toBe('ok');
    expect(r.markdown).toContain('Sheet1');
  }, 60_000);

  it('pptx — fflate + xmldom 在 worker 上下文能装载', async () => {
    const buf = new Uint8Array(readFileSync(join(FIXTURES, '2-slides.pptx'))).buffer;
    const r = await rpc('pptx', buf);
    expect(r.type).toBe('ok');
    expect(r.markdown).toMatch(/Slide\s+1/);
  }, 60_000);
});
