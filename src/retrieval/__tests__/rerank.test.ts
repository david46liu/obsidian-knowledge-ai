import { describe, it, expect } from 'vitest';
import { RerankerRegistry } from 'src/retrieval/rerank';
import type { Reranker } from 'src/retrieval/types';

const noop: Reranker = {
  name: 'noop',
  async rerank(_q, hits) { return hits; },
};

describe('RerankerRegistry', () => {
  it('register + get', () => {
    const reg = new RerankerRegistry();
    reg.register(noop);
    expect(reg.get('noop')).toBe(noop);
  });

  it('get returns undefined for unknown name', () => {
    const reg = new RerankerRegistry();
    expect(reg.get('missing')).toBeUndefined();
  });

  it('duplicate register overrides (with warning left to caller)', () => {
    const reg = new RerankerRegistry();
    reg.register(noop);
    const other: Reranker = { name: 'noop', async rerank(_q, h) { return h.slice().reverse(); } };
    reg.register(other);
    expect(reg.get('noop')).toBe(other);
  });

  it('list returns all registered names', () => {
    const reg = new RerankerRegistry();
    reg.register(noop);
    reg.register({ name: 'b', async rerank(_q, h) { return h; } });
    expect(new Set(reg.list())).toEqual(new Set(['noop', 'b']));
  });
});
