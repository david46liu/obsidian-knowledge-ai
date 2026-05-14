import { describe, it, expect } from 'vitest';
import { isOverHardLimit } from 'src/services/officeLimits';

describe('isOverHardLimit', () => {
  it('docx 31MB 桌面超限', () => {
    expect(isOverHardLimit('docx', 31 * 1024 * 1024, false)).toBe(true);
  });

  it('docx 5MB 桌面不超限', () => {
    expect(isOverHardLimit('docx', 5 * 1024 * 1024, false)).toBe(false);
  });

  it('mobile 11MB pptx 超限(忽略格式表)', () => {
    expect(isOverHardLimit('pptx', 11 * 1024 * 1024, true)).toBe(true);
  });

  it('未知扩展名 desktop → 不超限(无表项)', () => {
    expect(isOverHardLimit('unknown', 999 * 1024 * 1024, false)).toBe(false);
  });
});
