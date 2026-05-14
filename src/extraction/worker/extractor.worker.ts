// src/extraction/worker/extractor.worker.ts
// Worker entry — bundled separately (T9).  Receives WorkerInbound messages,
// runs hash + extract, replies via WorkerOutbound.

// DedicatedWorkerGlobalScope is in the WebWorker lib, not DOM.
// Declare it locally so this file types cleanly without changing tsconfig.
declare const self: {
  addEventListener(
    type: 'message',
    listener: (evt: MessageEvent) => void,
  ): void;
  postMessage(data: unknown): void;
  crypto: { subtle: { digest(algo: string, data: BufferSource): Promise<ArrayBuffer> } };
};

import { ExtractorRegistry } from 'src/extraction/registry';
import { markdownExtractor } from 'src/extraction/markdown';
import type { WorkerInbound, WorkerOutbound } from './protocol';

const registry = new ExtractorRegistry();
registry.register(['md', 'txt'], async () => markdownExtractor);
registry.register(['docx'], () =>
  import('src/extraction/docx/extractor').then(m => m.docxExtractor),
);
registry.register(['xlsx'], () =>
  import('src/extraction/xlsx/extractor').then(m => m.xlsxExtractor),
);
registry.register(['pptx'], () =>
  import('src/extraction/pptx/extractor').then(m => m.pptxExtractor),
);
registry.register(['pdf'], () =>
  import('src/extraction/pdf/extractor').then(m => m.pdfExtractor),
);

self.addEventListener('message', async (evt: MessageEvent<WorkerInbound>) => {
  const msg = evt.data;
  if (msg.type !== 'extract') return; // cancel coarse — main thread relies on terminate

  const { id, ext, buffer, opts } = msg;
  try {
    const extractor = await registry.get(ext);
    if (!extractor) {
      reply({ id, type: 'error', errorClass: 'parse', message: `no extractor for .${ext}` });
      return;
    }

    const hashBuffer = await self.crypto.subtle.digest('SHA-256', buffer);
    const hash = bufToHex(hashBuffer);

    const result = await extractor.extract(buffer, opts);
    reply({
      id,
      type: 'ok',
      hash,
      markdown: result.markdown,
      locatorMap: result.locatorMap,
    });
  } catch (e) {
    reply({
      id,
      type: 'error',
      errorClass: 'parse',
      message: e instanceof Error ? e.message : String(e),
    });
  }
});

function reply(msg: WorkerOutbound): void {
  self.postMessage(msg);
}

function bufToHex(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}
