import type { WorkerErrorClass } from './protocol';
import type { LocatorMapEntry } from 'src/extraction/types';

export interface ExtractRequest {
  ext: string;
  buffer: ArrayBuffer;
  opts: Record<string, unknown>;
}

export interface ExtractResponse {
  hash: string;
  markdown: string;
  locatorMap: LocatorMapEntry[];
}

export class WorkerHostError extends Error {
  constructor(message: string, public readonly errorClass: WorkerErrorClass) {
    super(message);
    this.name = 'WorkerHostError';
  }
}

export interface IWorkerHost {
  extract(req: ExtractRequest, signal?: AbortSignal): Promise<ExtractResponse>;
  shutdown(): Promise<void>;
}
