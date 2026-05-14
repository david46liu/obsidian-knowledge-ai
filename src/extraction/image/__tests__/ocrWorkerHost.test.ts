import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OCRWorkerHost } from 'src/extraction/image/ocrWorkerHost';

const mockRecognize = vi.fn();
const mockTerminate = vi.fn();
const mockCreateWorker = vi.fn();

vi.mock('tesseract.js', () => ({
  createWorker: (...args: unknown[]) => mockCreateWorker(...args),
}));

beforeEach(() => {
  mockRecognize.mockReset();
  mockTerminate.mockReset();
  mockCreateWorker.mockReset();
  mockTerminate.mockResolvedValue(undefined);
  mockCreateWorker.mockResolvedValue({
    recognize: mockRecognize,
    terminate: mockTerminate,
  });
});

describe('OCRWorkerHost', () => {
  it('init creates worker with langs and caches result for second init', async () => {
    const host = new OCRWorkerHost();
    await host.init(['chi_sim', 'eng']);
    await host.init(['chi_sim', 'eng']);  // second call should be no-op
    expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    expect(mockCreateWorker).toHaveBeenCalledWith(['chi_sim', 'eng'], 1, expect.any(Object));
  });

  it('recognize returns text and confidence trimmed', async () => {
    mockRecognize.mockResolvedValue({ data: { text: '  hello world  \n', confidence: 92.5 } });
    const host = new OCRWorkerHost();
    await host.init(['eng']);
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const result = await host.recognize(bytes, 'image/png');
    expect(result.text).toBe('hello world');
    expect(result.confidence).toBe(92.5);
    expect(mockRecognize).toHaveBeenCalledOnce();
  });

  it('recognize without init throws', async () => {
    const host = new OCRWorkerHost();
    await expect(host.recognize(new Uint8Array([1]).buffer, 'image/png'))
      .rejects.toThrow(/not initialized/i);
  });

  it('shutdown terminates worker and clears state', async () => {
    const host = new OCRWorkerHost();
    await host.init(['eng']);
    await host.shutdown();
    expect(mockTerminate).toHaveBeenCalledOnce();
    // After shutdown, recognize should throw again
    await expect(host.recognize(new Uint8Array([1]).buffer, 'image/png'))
      .rejects.toThrow(/not initialized/i);
  });

  it('concurrent init calls share the same initialization promise', async () => {
    let resolveWorker!: (w: unknown) => void;
    mockCreateWorker.mockReturnValue(new Promise(r => { resolveWorker = r; }));
    const host = new OCRWorkerHost();
    const p1 = host.init(['eng']);
    const p2 = host.init(['eng']);
    resolveWorker({ recognize: mockRecognize, terminate: mockTerminate });
    await Promise.all([p1, p2]);
    expect(mockCreateWorker).toHaveBeenCalledTimes(1);
  });
});
