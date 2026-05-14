import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr } from 'src/utils/result';

describe('Result', () => {
  it('ok wraps value', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it('err wraps error', () => {
    const r = err(new Error('boom'));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toBe('boom');
  });

  it('isOk and isErr are mutually exclusive', () => {
    const r = ok('x');
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });
});
