import { describe, it, expect, vi } from 'vitest';
import { makeImageExtractor, buildImageMarkdown, type ImageExtractorDeps } from 'src/extraction/image/extractor';
import type { LLMClient, ProviderCapabilities } from 'src/providers/types';
import type { Logger } from 'src/infra/logger';

const noopLogger: Logger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, setLevel: () => {},
};

const caps: ProviderCapabilities = {
  supportsJsonMode: false, supportsStreaming: true, supportsTools: false,
  supportsTemperature: true, supportsMaxTokens: true, maxTokensFieldName: 'max_tokens',
  supportsEmbeddings: false, supportsVision: true,
};

function makeMockClient(response: string): LLMClient {
  return {
    capabilities: caps,
    chat: async () => ({ content: response }),
    async *chatStream() { yield { type: 'done' as const }; },
  };
}

function makeMockOcrHost(text: string, succeed = true) {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    recognize: succeed
      ? vi.fn().mockResolvedValue({ text, confidence: 90 })
      : vi.fn().mockRejectedValue(new Error('ocr boom')),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isReady: () => true,
  } as unknown as NonNullable<ImageExtractorDeps['ocrHost']>;
}

// Mock the resizer to avoid OffscreenCanvas in vitest jsdom
vi.mock('src/extraction/image/resize', () => ({
  resizeImageBytes: vi.fn().mockImplementation(async (bytes: ArrayBuffer, mimeType: string) => ({ bytes, mimeType })),
  computeTargetDimensions: vi.fn(),
}));

const defaultConfig = () => ({
  ocrEnabled: true,
  ocrLangs: ['eng'],
  visionEnabled: true,
  maxImageBytes: 5_000_000,
});

const tinyBytes = new Uint8Array([1, 2, 3]).buffer;

describe('imageExtractor.extract', () => {
  it('both OCR and Vision succeed → markdown contains both sections', async () => {
    const ext = makeImageExtractor({
      resolveVisionClient: () => ({ client: makeMockClient('视觉描述：一只猫'), model: 'gpt-4o' }),
      ocrHost: makeMockOcrHost('OCR 文本内容'),
      config: defaultConfig,
      logger: noopLogger,
    });
    const r = await ext.extract(tinyBytes, { filename: 'cat.png', mimeType: 'image/png' });
    expect(r.markdown).toContain('## OCR 文字');
    expect(r.markdown).toContain('OCR 文本内容');
    expect(r.markdown).toContain('## 视觉描述');
    expect(r.markdown).toContain('视觉描述：一只猫');
    expect(r.locatorMap).toEqual([]);
  });

  it('OCR fails, Vision ok → only vision section', async () => {
    const ext = makeImageExtractor({
      resolveVisionClient: () => ({ client: makeMockClient('描述'), model: 'gpt-4o' }),
      ocrHost: makeMockOcrHost('', false),
      config: defaultConfig,
      logger: noopLogger,
    });
    const r = await ext.extract(tinyBytes, { filename: 'x.png', mimeType: 'image/png' });
    expect(r.markdown).not.toContain('## OCR 文字');
    expect(r.markdown).toContain('## 视觉描述');
  });

  it('Vision unconfigured (no provider assigned), OCR ok → only OCR section', async () => {
    const ext = makeImageExtractor({
      resolveVisionClient: () => null,
      ocrHost: makeMockOcrHost('hello world'),
      config: defaultConfig,
      logger: noopLogger,
    });
    const r = await ext.extract(tinyBytes, { filename: 'x.png', mimeType: 'image/png' });
    expect(r.markdown).toContain('## OCR 文字');
    expect(r.markdown).toContain('hello world');
    expect(r.markdown).not.toContain('## 视觉描述');
  });

  it('both fail → placeholder text, still markdown', async () => {
    const ext = makeImageExtractor({
      resolveVisionClient: () => null,
      ocrHost: null,
      config: defaultConfig,
      logger: noopLogger,
    });
    const r = await ext.extract(tinyBytes, { filename: 'x.png', mimeType: 'image/png' });
    expect(r.markdown).toContain('图片索引失败');
    expect(r.markdown).toContain('x.png');
  });

  it('image too large → placeholder, no OCR or vision invoked', async () => {
    const ocrHost = makeMockOcrHost('should-not-be-called');
    const ext = makeImageExtractor({
      resolveVisionClient: () => ({ client: makeMockClient('also-not-called'), model: 'm' }),
      ocrHost,
      config: () => ({ ...defaultConfig(), maxImageBytes: 2 }),
      logger: noopLogger,
    });
    const r = await ext.extract(tinyBytes, { filename: 'huge.png', mimeType: 'image/png' });
    expect(r.markdown).toContain('图片过大跳过索引');
    expect(ocrHost.recognize).not.toHaveBeenCalled();
  });

  it('ocrEnabled=false skips OCR even if host is available', async () => {
    const ocrHost = makeMockOcrHost('text');
    const ext = makeImageExtractor({
      resolveVisionClient: () => ({ client: makeMockClient('vis'), model: 'm' }),
      ocrHost,
      config: () => ({ ...defaultConfig(), ocrEnabled: false }),
      logger: noopLogger,
    });
    const r = await ext.extract(tinyBytes, { filename: 'x.png', mimeType: 'image/png' });
    expect(r.markdown).not.toContain('## OCR 文字');
    expect(r.markdown).toContain('## 视觉描述');
    expect(ocrHost.recognize).not.toHaveBeenCalled();
  });
});

describe('buildImageMarkdown', () => {
  it('renders both sections in expected order', () => {
    const md = buildImageMarkdown({ filename: 'a.png', ocrText: 'ocr', visionText: 'vis' });
    const ocrIdx = md.indexOf('## OCR 文字');
    const visIdx = md.indexOf('## 视觉描述');
    expect(ocrIdx).toBeGreaterThan(0);
    expect(visIdx).toBeGreaterThan(ocrIdx);
  });

  it('returns failure placeholder when both null', () => {
    const md = buildImageMarkdown({ filename: 'a.png', ocrText: null, visionText: null });
    expect(md).toContain('(图片索引失败)');
  });
});
