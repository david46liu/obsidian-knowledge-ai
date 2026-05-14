// Main-thread PDF extractor stub. Carries the correct `version` (read from
// version.ts so it stays in sync with the real extractor) but throws on
// extract — the real PDF.js code runs in the worker via workerHost.extract.
//
// Why a stub: IndexService only reads extractor.version on the main thread
// (for parser-version cache validation) and dispatches the actual extract()
// to the worker. Importing the real extractor on the main thread pulls in
// pdfjs-dist, whose top-level code runs `globalThis.pdfjsWorker = {...}`,
// breaking Obsidian's built-in PDF viewer (and PDF++).
import type { Extractor } from 'src/extraction/types';
import { PDF_EXTRACTOR_VERSION } from './version';

export const pdfExtractorStub: Extractor = {
  extensions: ['pdf'],
  version: PDF_EXTRACTOR_VERSION,
  async extract(): Promise<never> {
    throw new Error('pdf extraction must run inside the worker (use workerHost.extract)');
  },
};
