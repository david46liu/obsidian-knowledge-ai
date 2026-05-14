import { describe, it, expect, vi } from 'vitest';
import { ExtractorRegistry } from 'src/extraction/registry';
import type { Extractor } from 'src/extraction/types';

const stubExtractor: Extractor = {
  extensions: ['xx'],
  version: 1,
  async extract(_bytes) {
    return { markdown: 'STUB', locatorMap: [] };
  },
};

describe('ExtractorRegistry', () => {
  it('has() returns true after register, false otherwise', () => {
    const r = new ExtractorRegistry();
    r.register(['xx'], async () => stubExtractor);
    expect(r.has('xx')).toBe(true);
    expect(r.has('yy')).toBe(false);
  });

  it('extension lookup is case-insensitive', () => {
    const r = new ExtractorRegistry();
    r.register(['XX'], async () => stubExtractor);
    expect(r.has('xx')).toBe(true);
    expect(r.has('Xx')).toBe(true);
  });

  it('get() lazy-loads on first access then caches', async () => {
    const r = new ExtractorRegistry();
    const loader = vi.fn(async () => stubExtractor);
    r.register(['xx'], loader);
    expect(loader).toHaveBeenCalledTimes(0);
    const e1 = await r.get('xx');
    expect(loader).toHaveBeenCalledTimes(1);
    const e2 = await r.get('xx');
    expect(loader).toHaveBeenCalledTimes(1);   // cached
    expect(e1).toBe(e2);
  });

  it('get() returns undefined for unregistered extension', async () => {
    const r = new ExtractorRegistry();
    expect(await r.get('zz')).toBeUndefined();
  });

  it('knownExtensions returns all registered exts (lowercase, sorted)', () => {
    const r = new ExtractorRegistry();
    r.register(['MD', 'TXT'], async () => stubExtractor);
    r.register(['docx'], async () => stubExtractor);
    expect(r.knownExtensions().sort()).toEqual(['docx', 'md', 'txt']);
  });

  it('syncGet returns cached extractor only', async () => {
    const r = new ExtractorRegistry();
    r.register(['xx'], async () => stubExtractor);
    expect(r.syncGet('xx')).toBeUndefined();
    await r.get('xx');
    expect(r.syncGet('xx')).toBe(stubExtractor);
  });

  it('get() concurrent calls share single loader invocation', async () => {
    const r = new ExtractorRegistry();
    let loaderCallCount = 0;
    const loader = vi.fn(async () => {
      loaderCallCount++;
      // delay so concurrent calls have time to overlap
      await new Promise(resolve => setTimeout(resolve, 10));
      return stubExtractor;
    });
    r.register(['xx'], loader);

    // fire 3 concurrent get() calls — should all resolve to same extractor and loader called once
    const [e1, e2, e3] = await Promise.all([r.get('xx'), r.get('xx'), r.get('xx')]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(e1).toBe(e2);
    expect(e2).toBe(e3);
  });
});
