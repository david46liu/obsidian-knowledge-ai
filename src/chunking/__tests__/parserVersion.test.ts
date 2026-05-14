import { describe, it, expect } from 'vitest';
import { computeParserVersion, PARSER_VERSION } from 'src/chunking/types';

describe('parserVersion', () => {
  it('returns deterministic positive integer', () => {
    const v = computeParserVersion(1, '');
    expect(typeof v).toBe('number');
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });

  it('changes when extractorVersion changes', () => {
    const a = computeParserVersion(1, '');
    const b = computeParserVersion(2, '');
    expect(a).not.toBe(b);
  });

  it('changes when optsKey changes', () => {
    const a = computeParserVersion(1, '');
    const b = computeParserVersion(1, '{"includeNotes":true}');
    expect(a).not.toBe(b);
  });

  it('is stable for same inputs', () => {
    expect(computeParserVersion(1, 'x')).toBe(computeParserVersion(1, 'x'));
  });

  it('PARSER_VERSION baseline is 2 (bumped for office indexing)', () => {
    expect(PARSER_VERSION).toBe(2);
  });
});
