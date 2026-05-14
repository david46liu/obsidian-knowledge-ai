import { describe, it, expect } from 'vitest';
import { computeTargetDimensions } from 'src/extraction/image/resize';

describe('computeTargetDimensions', () => {
  it('returns null when both dimensions already <= maxLong', () => {
    expect(computeTargetDimensions(1000, 800, 1568)).toBeNull();
    expect(computeTargetDimensions(1568, 1568, 1568)).toBeNull();
  });

  it('scales landscape image by long edge', () => {
    expect(computeTargetDimensions(3000, 2000, 1568)).toEqual({ w: 1568, h: 1045 });
  });

  it('scales portrait image by long edge', () => {
    expect(computeTargetDimensions(1000, 3000, 1568)).toEqual({ w: 523, h: 1568 });
  });

  it('handles square image larger than maxLong', () => {
    expect(computeTargetDimensions(2000, 2000, 1568)).toEqual({ w: 1568, h: 1568 });
  });

  it('rounds to nearest integer', () => {
    // 3001 * (1568 / 3001) = 1568 exact; 2003 * (1568 / 3001) = 1046.5… → 1047
    const out = computeTargetDimensions(3001, 2003, 1568);
    expect(out).toEqual({ w: 1568, h: 1047 });
  });
});
