import type { ExtractorRegistry } from 'src/extraction/registry';
import type { HashContentFn } from 'src/indexer/types';
import type { ExtractRequest, ExtractResponse, IWorkerHost } from './types';
import { WorkerHostError } from './types';

export interface InProcessWorkerHostDeps {
  registry: ExtractorRegistry;
  hashFn: HashContentFn;
}

export class InProcessWorkerHost implements IWorkerHost {
  constructor(private readonly deps: InProcessWorkerHostDeps) {}

  async extract(req: ExtractRequest, signal?: AbortSignal): Promise<ExtractResponse> {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const extractor = await this.deps.registry.get(req.ext);
    if (!extractor) throw new WorkerHostError(`no extractor for .${req.ext}`, 'parse');

    const bytes = new Uint8Array(req.buffer);
    const hash = await this.deps.hashFn(bytes);
    try {
      const result = await extractor.extract(req.buffer, req.opts);
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return { hash, markdown: result.markdown, locatorMap: result.locatorMap };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new WorkerHostError(e instanceof Error ? e.message : String(e), 'parse');
    }
  }

  async shutdown(): Promise<void> { /* no-op */ }
}
