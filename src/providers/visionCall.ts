import type { LLMClient } from 'src/providers/types';

const SYSTEM_PROMPT =
  '你是图像分析助手。请简洁描述这张图片的视觉内容（人/物/场景/构图/颜色/可识别的文字），' +
  '中文输出，不超过 200 字。如果图片是截图（含 UI/代码/表格），重点描述结构和关键文本片段，' +
  '但不要尝试逐字 OCR（OCR 由其他工具完成）。';

export interface VisionCallParams {
  client: LLMClient;
  model: string;
  imageBytes: ArrayBuffer;
  mimeType: string;
  signal?: AbortSignal;
}

export async function callVision(p: VisionCallParams): Promise<string> {
  const dataUrl = `data:${p.mimeType};base64,${arrayBufferToBase64(p.imageBytes)}`;
  const res = await p.client.chat({
    model: p.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: SYSTEM_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
    signal: p.signal,
  });
  const trimmed = res.content?.trim() ?? '';
  if (!trimmed) throw new Error('vision returned empty content');
  return trimmed;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
