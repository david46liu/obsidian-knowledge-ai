// Use the legacy build so pdf.js works in Node.js / Web Worker environments
// without requiring browser globals (DOMMatrix, etc.)
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { Extractor, ExtractionResult, LocatorMapEntry } from 'src/extraction/types';
import { PDF_EXTRACTOR_VERSION } from './version';

// Wire the worker handler directly so pdf.js uses fake-worker (synchronous) mode.
// This avoids import.meta.url (undefined in CJS bundles) and prevents pdf.js from
// spawning a sub-worker — correct because we already run inside a Web Worker.
//
// Critical: only do this in worker contexts. Setting globalThis.pdfjsWorker on
// the main thread pollutes window.pdfjsWorker, which Obsidian's built-in PDF.js
// (and any plugin like PDF++ that uses it) reads via the fake-worker fallback.
// Our bundled pdfjs-dist@5.7.x WorkerMessageHandler is protocol-incompatible
// with Obsidian's built-in v5.3.x, causing PDF viewer pages to render blank.
const isWorker = typeof window === 'undefined' && typeof self !== 'undefined';
if (isWorker) {
  (globalThis as Record<string, unknown>).pdfjsWorker = { WorkerMessageHandler };
  GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
}

export const pdfExtractor: Extractor = {
  extensions: ['pdf'],
  version: PDF_EXTRACTOR_VERSION,

  async extract(buffer: ArrayBuffer): Promise<ExtractionResult> {
    const data = new Uint8Array(buffer);
    const loadingTask = getDocument({ data, disableAutoFetch: true, disableStream: true });
    const doc = await loadingTask.promise;

    let md = '';
    const locatorMap: LocatorMapEntry[] = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();

      const lines: string[] = [];
      let currentLine = '';
      for (const item of textContent.items) {
        if (!('str' in item)) continue;
        const textItem = item as TextItem;
        currentLine += textItem.str;
        if (textItem.hasEOL) {
          const trimmed = currentLine.trim();
          if (trimmed) lines.push(trimmed);
          currentLine = '';
        }
      }
      const trailing = currentLine.trim();
      if (trailing) lines.push(trailing);

      const pageText = lines.join('\n');
      if (!pageText) continue;

      const pageStart = md.length;
      md += `## Page ${pageNum}\n\n${pageText}\n\n`;
      locatorMap.push({
        charStart: pageStart,
        charEnd: md.length,
        locator: { kind: 'page', pageRange: [pageNum, pageNum] },
      });
    }

    await doc.destroy();
    return { markdown: md, locatorMap };
  },
};
