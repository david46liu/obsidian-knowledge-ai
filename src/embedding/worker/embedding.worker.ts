// Embedding worker — bundled separately (see esbuild.config.mjs).
// Runs @xenova/transformers pipeline without blocking the main thread.

declare const self: {
  addEventListener(type: 'message' | 'error' | 'unhandledrejection', listener: (evt: unknown) => void): void;
  postMessage(data: unknown): void;
  onerror?: ((evt: unknown) => void) | null;
};

import type { EmbedRequest, EmbedResponse } from './embeddingProtocol';

// Attach error listeners FIRST so any synchronous failure in module setup
// (including the Node-ness hide IIFE below) is captured and posted back to
// the host instead of surfacing as opaque "Uncaught [object ErrorEvent]".
self.addEventListener('error', (evt: unknown) => {
  try {
    const e = evt as { message?: string; filename?: string; lineno?: number; error?: { stack?: string } };
    const stack = e.error?.stack ? '\n' + e.error.stack.split('\n').slice(0, 6).join('\n') : '';
    self.postMessage({ id: -1, type: 'error', error: `WORKER UNCAUGHT: ${e.message ?? '(no message)'} @ ${e.filename ?? '?'}:${e.lineno ?? '?'}${stack}` });
  } catch { /* swallow */ }
});
self.addEventListener('unhandledrejection', (evt: unknown) => {
  try {
    const e = evt as { reason?: unknown };
    const reason = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}\n${(e.reason.stack ?? '').split('\n').slice(0, 6).join('\n')}` : String(e.reason);
    self.postMessage({ id: -1, type: 'error', error: `WORKER UNHANDLED REJECTION: ${reason}` });
  } catch { /* swallow */ }
});

// Hide Node-ness from emscripten BEFORE any code runs that might read it.
// onnxruntime-web's emscripten runtime checks
//   typeof process.versions.node === "string"
// to detect Node. In Electron worker that's true, so it takes the Node wasm
// loading path → require('path').dirname(...). But the browser webpack bundle
// stubbed 'path' (module 908) as `{}`, so .dirname is undefined and the wasm
// backend's init() throws "TypeError: r(...).dirname is not a function".
//
// Electron freezes process.versions (we can't reassign it), and replacing the
// whole process object on globalThis breaks everything downstream (no nextTick,
// no env, etc). The surgical fix: redefine ONLY the inner `node` entry via
// Object.defineProperty — that bypasses the writable:false on the versions
// object as long as `node` is configurable. Worker process.versions usually is.
// Worker-level diagnostic: report each setup step via postMessage so we can
// see exactly which one crashes. id=-2 = setup diagnostic line.
function setupDiag(line: string): void {
  try { self.postMessage({ id: -2, type: 'error', error: `SETUP: ${line}` }); } catch { /* swallow */ }
}

setupDiag('listeners attached');

(function hideNodeness() {
  try {
    const proc = (globalThis as { process?: { versions?: Record<string, unknown> } }).process;
    setupDiag(`hideNodeness: process=${typeof proc} versions=${typeof proc?.versions} node-before=${typeof (proc?.versions as { node?: unknown } | undefined)?.node}`);
    if (proc?.versions && (proc.versions as { node?: unknown }).node !== undefined) {
      Object.defineProperty(proc.versions, 'node', {
        value: undefined,
        configurable: true,
        writable: true,
        enumerable: true,
      });
      setupDiag(`hideNodeness: node-after=${typeof (proc.versions as { node?: unknown }).node}`);
    }
  } catch (e) {
    setupDiag(`hideNodeness failed: ${e instanceof Error ? e.message : String(e)}`);
  }
})();

setupDiag('module top reached end');

const DOCUMENT_PREFIX: Record<string, string> = {
  'Xenova/multilingual-e5-small': 'passage: ',
  'Xenova/multilingual-e5-base': 'passage: ',
  'Xenova/e5-small-v2': 'passage: ',
};
const QUERY_PREFIX: Record<string, string> = {
  'Xenova/multilingual-e5-small': 'query: ',
  'Xenova/multilingual-e5-base': 'query: ',
  'Xenova/e5-small-v2': 'query: ',
};

type PipelineFn = (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;
let extractor: PipelineFn | null = null;
let currentModelId: string | null = null;

function l2normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

self.addEventListener('message', async (evt: MessageEvent<EmbedRequest>) => {
  const msg = evt.data;

  if (msg.type === 'init') {
    setupDiag(`init received: modelId=${msg.modelId} hasWasmBytes=${!!msg.wasmBytes}`);
    const diag: string[] = [];
    try {
      setupDiag('init: entered try block');
      // process.versions.node and process.release.name are rewritten to literal
      // `undefined` at build time via esbuild's `define` option (see esbuild.config.mjs).
      // This makes emscripten's `typeof process.versions.node === "string"` evaluate
      // false and forces the browser wasm-loading branch, where our fetch interceptor
      // serves the in-memory wasm bytes.
      const g = globalThis as { process?: { versions?: { node?: unknown }; release?: { name?: unknown } } };
      diag.push(`real process.versions.node=${typeof g.process?.versions?.node} release.name=${g.process?.release?.name ?? '(n/a)'}`);

      // Monkey-patch fetch BEFORE importing transformers / onnxruntime-web.
      // The worker runs in an opaque origin so blob URLs aren't fetchable,
      // and onnxruntime-web 1.14 has no env.wasm.wasmBinary entry — its
      // env.wasm only honours wasmPaths (URLs). Intercept the wasm file
      // fetches by suffix match and serve the in-memory bytes back as a
      // Response with the correct application/wasm content-type.
      if (msg.wasmBytes) {
        const bytesByName = msg.wasmBytes;
        const origFetch = (globalThis as unknown as { fetch: typeof fetch }).fetch.bind(globalThis);
        (self as unknown as { fetch: typeof fetch }).fetch = (input, init) => {
          const url = typeof input === 'string' ? input
                    : input instanceof URL ? input.href
                    : (input as Request).url;
          for (const [name, bytes] of Object.entries(bytesByName)) {
            if (url.endsWith('/' + name) || url === name) {
              setupDiag(`fetch intercepted: ${name} → ${bytes.byteLength} bytes (url=${url.slice(0, 100)})`);
              return Promise.resolve(new Response(bytes, {
                status: 200,
                headers: { 'Content-Type': 'application/wasm' },
              }));
            }
          }
          setupDiag(`fetch passthrough: ${url.slice(0, 150)}`);
          return origFetch(input, init).then(
            r => { setupDiag(`fetch result ${r.status}: ${url.slice(0, 80)}`); return r; },
            e => { setupDiag(`fetch failed: ${url.slice(0, 80)} — ${e instanceof Error ? e.message : String(e)}`); throw e; }
          );
        };
        setupDiag(`fetch patched for ${Object.keys(bytesByName).join(',')}`);
      }

      setupDiag('init: about to import transformers');
      const { pipeline, env } = await import('@xenova/transformers');
      setupDiag('init: transformers import resolved');
      diag.push(`transformers loaded`);

      // Configure env IMMEDIATELY after import — before any code that might
      // trigger wasm init. transformers' env.js sets wasmPaths to the jsDelivr
      // CDN by default; we override with our in-memory bytes. We also force
      // numThreads=1 so emscripten picks the non-threaded simd variant
      // (threaded variant requires pthread sub-workers which fail to spawn
      // from a blob-URL worker → "Uncaught [object ErrorEvent]").
      if (msg.cacheDir) (env as { cacheDir?: string }).cacheDir = msg.cacheDir;
      (env as { allowRemoteModels?: boolean }).allowRemoteModels = true;

      const onnxEnv = (env as { backends?: { onnx?: { wasm?: {
        numThreads?: number;
        simd?: boolean;
        proxy?: boolean;
        wasmPaths?: string | Record<string, string>;
      } } } }).backends?.onnx;
      if (onnxEnv?.wasm) {
        onnxEnv.wasm.numThreads = 1;
        onnxEnv.wasm.proxy = false;
        onnxEnv.wasm.simd = !!msg.wasmBytes?.['ort-wasm-simd.wasm'];
        // onnxruntime-web 1.14 skips auto-setting wasmPaths when the worker is
        // loaded from a blob: URL. Without wasmPaths it builds garbage URLs like
        // "undefinedort-wasm-simd.wasm" and the wasm backend's init() throws,
        // which surfaces as "no available backend found". Set explicit URLs so
        // the path goes through fetch — our interceptor above then serves the
        // in-memory bytes. The host is intentionally a non-resolving "stub" —
        // the interceptor matches by filename suffix, not by host.
        if (msg.wasmBytes) {
          const paths: Record<string, string> = {};
          for (const name of Object.keys(msg.wasmBytes)) {
            paths[name] = `https://obsidian-local-wasm.invalid/${name}`;
          }
          onnxEnv.wasm.wasmPaths = paths;
          diag.push(`onnx env: numThreads=1 proxy=false simd=${onnxEnv.wasm.simd} wasmPaths=${JSON.stringify(paths)}`);
        } else {
          diag.push(`onnx env: numThreads=1 proxy=false simd=${onnxEnv.wasm.simd}`);
        }
      }

      setupDiag(`init: calling pipeline('feature-extraction', '${msg.modelId}')`);
      try {
        extractor = await pipeline('feature-extraction', msg.modelId!) as unknown as PipelineFn;
      } catch (pipeErr) {
        const m = pipeErr instanceof Error
          ? `${pipeErr.name}: ${pipeErr.message}\n${(pipeErr.stack ?? '').split('\n').slice(0, 8).join('\n')}`
          : String(pipeErr);
        setupDiag(`init: pipeline THREW: ${m}`);
        throw pipeErr;
      }
      setupDiag('init: pipeline resolved');
      currentModelId = msg.modelId!;
      const reply: EmbedResponse = { id: msg.id, type: 'ready' };
      self.postMessage(reply);
    } catch (e) {
      const formatErr = (err: unknown, depth: number): string => {
        if (depth > 4) return '[truncated]';
        if (err instanceof Error) {
          const stack = err.stack ? '\n' + err.stack.split('\n').slice(0, 6).join('\n') : '';
          const causeStr = (err as { cause?: unknown }).cause !== undefined
            ? `\n  ↳ cause: ${formatErr((err as { cause?: unknown }).cause, depth + 1)}`
            : '';
          return `${err.name}: ${err.message}${stack}${causeStr}`;
        }
        return String(err);
      };
      const errMsg = formatErr(e, 0);
      const fullErr = `${errMsg}\n\n— diagnostic —\n${diag.join('\n')}`;
      const reply: EmbedResponse = { id: msg.id, type: 'error', error: fullErr };
      self.postMessage(reply);
    }
    return;
  }

  if (msg.type === 'embed') {
    if (!extractor || !currentModelId) {
      self.postMessage({ id: msg.id, type: 'error', error: 'model not initialised' } satisfies EmbedResponse);
      return;
    }
    try {
      const prefix = msg.embedType === 'query'
        ? (QUERY_PREFIX[currentModelId] ?? '')
        : (DOCUMENT_PREFIX[currentModelId] ?? '');
      const prefixed = msg.texts!.map(t => prefix + t);
      const output = await extractor(prefixed, { pooling: 'mean', normalize: true });
      const dims = output.data.length / prefixed.length;
      const vectors: number[][] = Array.from({ length: prefixed.length }, (_, i) =>
        l2normalize(Array.from(output.data.slice(i * dims, (i + 1) * dims)))
      );
      self.postMessage({ id: msg.id, type: 'vectors', vectors } satisfies EmbedResponse);
    } catch (e) {
      self.postMessage({ id: msg.id, type: 'error', error: String(e) } satisfies EmbedResponse);
    }
  }
});
