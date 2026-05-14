import { describe, it, expect, vi } from 'vitest';
import { batchByTokens, shouldReEmbed, invalidateAllEmbeddings } from 'src/services/IndexService';
import { HashCacheStore } from 'src/indexer/hashCache';
import { InMemoryDataStoreAdapter } from 'src/adapters/__tests__/InMemoryDataStoreAdapter';
import { StoragePaths } from 'src/storage/paths';
import type { Chunk, HashCacheEntry } from 'src/types/data';

function mkChunk(id: string, tokens = 10): Chunk {
  const [hash] = id.split(':');
  return {
    id, chunkIndex: 0, fileHash: hash, filePath: 'a.md', sourceId: 's',
    headingText: '', headingPath: [], content: 'x'.repeat(tokens), contentHash: 'h',
    tokenCount: tokens, charStart: 0, charEnd: tokens, kind: 'paragraph',
  };
}

describe('batchByTokens', () => {
  it('batches chunks respecting token budget', () => {
    const chunks = Array.from({ length: 10 }, (_, i) => mkChunk(`h${i}:0`, 1000));
    const batches = batchByTokens(chunks);
    // 10 chunks × 1000 tokens = 10000 > MAX_BATCH_TOKENS(8192), should split
    expect(batches.length).toBeGreaterThan(1);
    const total = batches.reduce((s, b) => s + b.length, 0);
    expect(total).toBe(10);
  });

  it('keeps chunks within MAX_BATCH_COUNT=96 per batch', () => {
    const chunks = Array.from({ length: 200 }, (_, i) => mkChunk(`h${i}:0`, 1));
    const batches = batchByTokens(chunks);
    batches.forEach(b => expect(b.length).toBeLessThanOrEqual(96));
  });
});

describe('shouldReEmbed', () => {
  it('returns true when embeddingModelId is undefined', () => {
    const chunks = [mkChunk('hA:0')];
    const entry = { embeddingModelId: undefined, embeddings: undefined } as Partial<HashCacheEntry>;
    expect(shouldReEmbed(chunks, entry as HashCacheEntry, 'model-v1')).toBe(true);
  });

  it('returns true when modelId changed', () => {
    const chunks = [mkChunk('hA:0')];
    const entry = { embeddingModelId: 'model-v1', embeddings: { 'hA:0': [1] } } as Partial<HashCacheEntry>;
    expect(shouldReEmbed(chunks, entry as HashCacheEntry, 'model-v2')).toBe(true);
  });

  it('returns true when chunk set changed (chunk added)', () => {
    const chunks = [mkChunk('hA:0'), mkChunk('hA:1')];
    const entry = { embeddingModelId: 'model-v1', embeddings: { 'hA:0': [1] } } as Partial<HashCacheEntry>;
    expect(shouldReEmbed(chunks, entry as HashCacheEntry, 'model-v1')).toBe(true);
  });

  it('returns true when chunk set changed (chunk removed)', () => {
    const chunks = [mkChunk('hA:0')];
    const entry = { embeddingModelId: 'model-v1', embeddings: { 'hA:0': [1], 'hA:1': [2] } } as Partial<HashCacheEntry>;
    expect(shouldReEmbed(chunks, entry as HashCacheEntry, 'model-v1')).toBe(true);
  });

  it('returns false when modelId matches and chunk set is identical', () => {
    const chunks = [mkChunk('hA:0'), mkChunk('hA:1')];
    const entry = {
      embeddingModelId: 'model-v1',
      embeddings: { 'hA:0': [1], 'hA:1': [2] },
    } as Partial<HashCacheEntry>;
    expect(shouldReEmbed(chunks, entry as HashCacheEntry, 'model-v1')).toBe(false);
  });
});

describe('invalidateAllEmbeddings', () => {
  it('clears embeddingModelId and embeddings for all entries with modelId', async () => {
    const adapter = new InMemoryDataStoreAdapter();
    const paths = new StoragePaths('/p');
    const hc = new HashCacheStore(adapter, paths);
    await hc.load();

    const entryWithModel: HashCacheEntry = {
      fileHash: 'hA', fileSize: 10,
      chunks: [mkChunk('hA:0')],
      embeddings: { 'hA:0': [1] }, embeddingModelId: 'old-model',
      chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok',
    };
    const entryWithout: HashCacheEntry = {
      fileHash: 'hB', fileSize: 10,
      chunks: [mkChunk('hB:0')],
      chunkingVersion: 1, parserVersion: 1, indexedAt: 1, status: 'ok',
    };
    await hc.append(entryWithModel);
    await hc.append(entryWithout);

    const onInvalidate = vi.fn();
    await invalidateAllEmbeddings(hc, onInvalidate);

    const a = hc.get('hA');
    expect(a?.embeddingModelId).toBeUndefined();
    expect(a?.embeddings).toBeUndefined();
    // hB was not touched (had no modelId)
    const b = hc.get('hB');
    expect(b?.embeddings).toBeUndefined();
    expect(onInvalidate).toHaveBeenCalledOnce();
  });
});
