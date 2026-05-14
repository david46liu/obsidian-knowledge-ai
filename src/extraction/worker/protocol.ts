/** worker 错误归类;主线程据此决定 transient vs deterministic */
export type WorkerErrorClass =
  | 'parse'         // extractor 显式抛(损坏 / 不支持的 schema)→ deterministic
  | 'timeout'       // 主线程计时,worker 60s 无响应 → transient
  | 'worker-crash'; // worker 进程异常或 onerror → transient(WebWorkerHost respawn)

/** 主 → worker:请求 extract */
export interface WorkerExtractRequest {
  id: number;
  type: 'extract';
  ext: string;
  /** transferable */
  buffer: ArrayBuffer;
  /** extractor 选项,JSON 序列化结构(如 pptx 的 includeNotes) */
  opts: Record<string, unknown>;
}

/** 主 → worker:取消 in-flight */
export interface WorkerCancelRequest {
  id: number;
  type: 'cancel';
}

export type WorkerInbound = WorkerExtractRequest | WorkerCancelRequest;

/** worker → 主:成功 */
export interface WorkerExtractOk {
  id: number;
  type: 'ok';
  hash: string;
  markdown: string;
  locatorMap: Array<{ charStart: number; charEnd: number; locator: unknown }>;
}

/** worker → 主:解析错(deterministic) */
export interface WorkerExtractError {
  id: number;
  type: 'error';
  errorClass: 'parse';
  message: string;
}

export type WorkerOutbound = WorkerExtractOk | WorkerExtractError;

export const WORKER_DEFAULT_TIMEOUT_MS = 60_000;
