import type { Extractor, ExtractionResult } from 'src/extraction/types';
import type { LLMClient } from 'src/providers/types';
import type { Logger } from 'src/infra/logger';
import type { OCRWorkerHost } from 'src/extraction/image/ocrWorkerHost';
import { callVision } from 'src/providers/visionCall';
import { resizeImageBytes } from 'src/extraction/image/resize';

export interface ImageConfigSnapshot {
  ocrEnabled: boolean;
  ocrLangs: string[];
  visionEnabled: boolean;
  maxImageBytes: number;
}

export interface ImageExtractorDeps {
  resolveVisionClient: () => { client: LLMClient; model: string } | null;
  ocrHost: OCRWorkerHost | null;
  config: () => ImageConfigSnapshot;
  logger: Logger;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'gif'] as const;

export function makeImageExtractor(deps: ImageExtractorDeps): Extractor {
  return {
    extensions: IMAGE_EXTS,
    version: 1,
    extract: (bytes, opts) => extract(deps, bytes, opts),
  };
}

async function extract(
  deps: ImageExtractorDeps,
  bytes: ArrayBuffer,
  opts?: Record<string, unknown>,
): Promise<ExtractionResult> {
  const cfg = deps.config();
  const filename = (opts?.filename as string | undefined) ?? '(unknown)';
  const mimeType = (opts?.mimeType as string | undefined) ?? 'image/png';
  const signal = opts?.signal as AbortSignal | undefined;

  if (bytes.byteLength > cfg.maxImageBytes) {
    return {
      markdown: `> 图片: ${filename}\n\n(图片过大跳过索引: ${bytes.byteLength} bytes)\n`,
      locatorMap: [],
    };
  }

  const ocrPromise = (cfg.ocrEnabled && deps.ocrHost)
    ? deps.ocrHost.recognize(bytes, mimeType)
    : Promise.reject(new Error('ocr disabled or unavailable'));

  const visionPromise = (async () => {
    if (!cfg.visionEnabled) throw new Error('vision disabled');
    const v = deps.resolveVisionClient();
    if (!v) throw new Error('vision task not assigned');
    const { bytes: rb, mimeType: rmt } = await resizeImageBytes(bytes, mimeType);
    return callVision({ client: v.client, model: v.model, imageBytes: rb, mimeType: rmt, signal });
  })();

  const [ocrResult, visionResult] = await Promise.allSettled([ocrPromise, visionPromise]);

  const ocrText = ocrResult.status === 'fulfilled' ? ocrResult.value.text.trim() : null;
  const visionText = visionResult.status === 'fulfilled' ? visionResult.value.trim() : null;

  if (ocrResult.status === 'rejected' && cfg.ocrEnabled && deps.ocrHost) {
    deps.logger.warn(`OCR failed for ${filename}: ${ocrResult.reason}`);
  }
  if (visionResult.status === 'rejected' && cfg.visionEnabled) {
    deps.logger.warn(`Vision failed for ${filename}: ${visionResult.reason}`);
  }

  return {
    markdown: buildImageMarkdown({ filename, ocrText, visionText }),
    locatorMap: [],
  };
}

export function buildImageMarkdown(p: {
  filename: string;
  ocrText: string | null;
  visionText: string | null;
}): string {
  const lines: string[] = [`> 图片: ${p.filename}`, ''];
  if (!p.ocrText && !p.visionText) {
    lines.push('(图片索引失败)', '');
    return lines.join('\n');
  }
  if (p.ocrText) {
    lines.push('## OCR 文字', '', p.ocrText, '');
  }
  if (p.visionText) {
    lines.push('## 视觉描述', '', p.visionText, '');
  }
  return lines.join('\n');
}
