// Shared version constant for the PDF extractor. Kept in a standalone module
// with zero dependencies so the main thread can read it without importing
// pdfjs-dist (whose top-level code writes globalThis.pdfjsWorker, conflicting
// with Obsidian's built-in PDF.js).
export const PDF_EXTRACTOR_VERSION = 1;
