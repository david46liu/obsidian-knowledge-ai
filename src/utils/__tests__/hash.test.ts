import { describe, it, expect } from 'vitest';
import { computeHash } from 'src/utils/hash';

const enc = (s: string) => new TextEncoder().encode(s);

describe('computeHash', () => {
  it('returns 64-char hex string', async () => {
    const h = await computeHash(enc('hello'));
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same content → same hash', async () => {
    const a = await computeHash(enc('abc'));
    const b = await computeHash(enc('abc'));
    expect(a).toBe(b);
  });

  it('different content → different hash', async () => {
    const a = await computeHash(enc('abc'));
    const b = await computeHash(enc('xyz'));
    expect(a).not.toBe(b);
  });

  it('empty bytes → valid hash', async () => {
    const h = await computeHash(enc(''));
    expect(h).toHaveLength(64);
  });

  it('hashes subarray correctly (uses byteOffset/byteLength, not full buffer)', async () => {
    const full = new Uint8Array([0xAA, 0xBB, 0x68, 0x69, 0xCC]);  // 5 bytes
    const subview = full.subarray(2, 4);  // 'hi' = [0x68, 0x69]
    const hStandalone = await computeHash(new Uint8Array([0x68, 0x69]));
    const hSubview = await computeHash(subview);
    expect(hSubview).toBe(hStandalone);   // 必须等价,如果用 bytes.buffer 则会哈希全 5 字节
  });
});
