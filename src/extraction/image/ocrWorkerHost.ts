import type { Worker as TesseractWorker } from 'tesseract.js';

export interface OCRResult {
  text: string;
  confidence: number;
}

export interface OCRWorkerOptions {
  cachePath?: string;
  langPath?: string;
  corePath?: string;
  workerPath?: string;
}

/**
 * Wraps a Tesseract.js worker for image-to-text. Single-worker singleton —
 * call init() before the first recognize(); shutdown() releases the WebWorker.
 */
export class OCRWorkerHost {
  private worker: TesseractWorker | null = null;
  private initPromise: Promise<void> | null = null;
  private currentLangs: string[] = [];

  async init(langs: string[] = ['chi_sim', 'eng'], options: OCRWorkerOptions = {}): Promise<void> {
    if (this.worker && this.sameLangs(langs)) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (this.worker) {
        await this.worker.terminate().catch(() => {});
        this.worker = null;
      }
      const { createWorker } = await import('tesseract.js');
      // When tesseract.js is bundled by esbuild, its automatic resolution of
      // workerPath / corePath via import.meta.url fails (the worker receives
      // `undefined` URLs and crashes with "Failed to execute 'importScripts'").
      // Provide explicit CDN URLs as fallback. jsDelivr is generally faster
      // than unpkg from China.
      this.worker = await createWorker(langs, 1, {
        workerPath: options.workerPath
          ?? 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/worker.min.js',
        corePath: options.corePath
          ?? 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7',
        langPath: options.langPath
          ?? 'https://tessdata.projectnaptha.com/4.0.0',
        logger: () => { /* silence */ },
      });
      this.currentLangs = langs;
    })();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async recognize(bytes: ArrayBuffer, mimeType: string): Promise<OCRResult> {
    if (!this.worker) throw new Error('OCRWorkerHost not initialized');
    const blob = new Blob([bytes], { type: mimeType });
    const { data } = await this.worker.recognize(blob);
    return { text: data.text.trim(), confidence: data.confidence };
  }

  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate().catch(() => {});
      this.worker = null;
    }
    this.initPromise = null;
    this.currentLangs = [];
  }

  isReady(): boolean {
    return this.worker !== null;
  }

  private sameLangs(langs: string[]): boolean {
    if (langs.length !== this.currentLangs.length) return false;
    return langs.every((l, i) => l === this.currentLangs[i]);
  }
}
