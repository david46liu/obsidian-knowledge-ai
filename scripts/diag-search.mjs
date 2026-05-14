// Diagnostic: load real BM25 index from vault, run query, print top hits with full chunk metadata.
// Usage: node scripts/diag-search.mjs "查询词"

import { promises as fs } from 'fs';
import { join } from 'path';
import MiniSearch from 'minisearch';

const VAULT = 'C:/Users/21027/知识库/技术库';
const PLUGIN_DIR = join(VAULT, '.obsidian/plugins/notebook-ai');
const NOTEBOOK_ID = 'b599cb33-b0df-4b78-a04e-64f001d63d4f';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const tokenize = (s) => {
  if (!s) return [];
  const out = [];
  for (const { segment } of segmenter.segment(s)) {
    if (segment.trim().length > 0) out.push(segment);
  }
  return out;
};

const query = process.argv[2] ?? 'harness详细解释一下';
console.log(`Query: "${query}"`);
console.log(`Tokenized: [${tokenize(query).join(', ')}]`);

// Load BM25 index
const indexFile = join(PLUGIN_DIR, 'indexes', `${NOTEBOOK_ID}.msearch.json`);
const indexRaw = await fs.readFile(indexFile, 'utf8');
const indexData = JSON.parse(indexRaw);

const ms = MiniSearch.loadJS(indexData.miniSearchState, {
  fields: ['headingText', 'content', 'path'],
  storeFields: ['id'],
  idField: 'id',
  tokenize,
  searchOptions: { tokenize },
});

console.log(`\nBM25 index loaded. Document count: ${ms.documentCount}`);

// Run search with the same options as production
const hits = ms.search(query, {
  fuzzy: 0.1,
  prefix: true,
  boost: { headingText: 2 },
  combineWith: 'OR',
});

console.log(`\nRaw BM25 hits: ${hits.length} (showing top 20)`);

// Load hash cache to get full chunk content
const hashesFile = join(PLUGIN_DIR, 'cache', 'hashes.jsonl');
const hashesRaw = await fs.readFile(hashesFile, 'utf8');
const chunkById = new Map();
for (const line of hashesRaw.split('\n')) {
  if (!line.trim()) continue;
  try {
    const entry = JSON.parse(line);
    if (entry.chunks) {
      for (const c of entry.chunks) {
        chunkById.set(c.id, c);
      }
    }
  } catch {}
}

console.log(`Hash cache loaded. Total chunks: ${chunkById.size}\n`);

console.log('─'.repeat(100));
for (let i = 0; i < Math.min(20, hits.length); i++) {
  const h = hits[i];
  const chunk = chunkById.get(h.id);
  console.log(`#${i+1}  score=${h.score.toFixed(3)}  match=${JSON.stringify(h.match)}`);
  if (chunk) {
    console.log(`  path: ${chunk.filePath}`);
    console.log(`  heading: ${chunk.headingText || '(none)'} | path: ${(chunk.headingPath || []).join(' > ')}`);
    console.log(`  content (${chunk.content.length}c): ${chunk.content.slice(0, 200).replace(/\n/g, ' ')}`);
  } else {
    console.log(`  [chunk not found in cache for id=${h.id}]`);
  }
  console.log('─'.repeat(100));
}
