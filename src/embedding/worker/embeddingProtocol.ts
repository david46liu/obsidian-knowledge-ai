export interface EmbedRequest {
  id: number;
  type: 'init' | 'embed';
  /** init only */
  modelId?: string;
  cacheDir?: string;
  /** init only — raw bytes for ONNX wasm files, keyed by filename. Worker
   *  creates same-origin blob URLs from these (cross-origin blob URLs from
   *  the main thread are not fetchable from a blob-URL-spawned worker). */
  wasmBytes?: Record<string, ArrayBuffer>;
  /** embed only */
  texts?: string[];
  embedType?: 'document' | 'query';
}

export interface EmbedResponse {
  id: number;
  type: 'ready' | 'vectors' | 'error' | 'progress';
  vectors?: number[][];
  error?: string;
  pct?: number;
}
