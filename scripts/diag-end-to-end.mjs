// End-to-end search validation:
// 1. Load real BM25 index from vault
// 2. Run BM25 search
// 3. Apply excludeGlobs filter (simulating reindex result)
// 4. Call Moonshot LLM to rerank top candidates
// 5. Print final ranked results
//
// Usage: node scripts/diag-end-to-end.mjs "查询词"

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
console.log(`\n=== Query: "${query}" ===`);
console.log(`Tokenized: [${tokenize(query).join(', ')}]\n`);

// ── 1. Load notebook config (for excludeGlobs) ───────────────
const nbFile = join(PLUGIN_DIR, 'notebooks', `${NOTEBOOK_ID}.json`);
const notebook = JSON.parse(await fs.readFile(nbFile, 'utf8'));
const excludes = notebook.sources[0].excludeGlobs ?? [];
console.log(`Notebook excludeGlobs: ${JSON.stringify(excludes)}\n`);

// matchesGlob from src/indexer/scope.ts
function matchesGlob(path, pattern) {
  if (!pattern) return false;
  if (pattern === path) return true;
  if (pattern.startsWith('*') && pattern.length > 1) return path.endsWith(pattern.slice(1));
  if (pattern.endsWith('*') && pattern.length > 1) return path.startsWith(pattern.slice(0, -1));
  return false;
}

const isExcluded = (path) => excludes.some(g => matchesGlob(path, g));

// ── 2. Load chunks ───────────────────────────────────────────
const hashesRaw = await fs.readFile(join(PLUGIN_DIR, 'cache', 'hashes.jsonl'), 'utf8');
const chunkById = new Map();
for (const line of hashesRaw.split('\n')) {
  if (!line.trim()) continue;
  try {
    const entry = JSON.parse(line);
    if (entry.chunks) for (const c of entry.chunks) chunkById.set(c.id, c);
  } catch {}
}

// ── 3. Build BM25 index from chunks (post-excludeGlobs) ──────
// dedupe by fileHash (mimics IndexService.ensureBM25ForNotebook)
const ms = new MiniSearch({
  fields: ['headingText', 'content', 'path'],
  storeFields: ['id'],
  idField: 'id',
  tokenize,
  searchOptions: { tokenize },
});

let totalChunks = 0;
let excludedChunks = 0;
for (const chunk of chunkById.values()) {
  totalChunks++;
  if (isExcluded(chunk.filePath)) { excludedChunks++; continue; }
  ms.add({
    id: chunk.id,
    headingText: chunk.headingText,
    content: chunk.content,
    path: chunk.filePath,
  });
}
console.log(`Indexed ${ms.documentCount} chunks (excluded ${excludedChunks} of ${totalChunks} from templates)\n`);

// ── 4. BM25 search ───────────────────────────────────────────
const rawHits = ms.search(query, { fuzzy: 0.1, prefix: true, boost: { headingText: 2 }, combineWith: 'OR' });
console.log(`BM25 raw hits: ${rawHits.length}`);

const candidates = [];
for (const h of rawHits.slice(0, 20)) {
  const chunk = chunkById.get(h.id);
  if (!chunk) continue;
  candidates.push({ chunk, bm25Score: h.score });
}
console.log(`Candidates: ${candidates.length}\n`);

console.log('─── BM25 results (after filter, before rerank) ───');
for (let i = 0; i < Math.min(10, candidates.length); i++) {
  const c = candidates[i];
  console.log(`#${i+1}  bm25=${c.bm25Score.toFixed(2)}  ${c.chunk.headingText || c.chunk.filePath}`);
  console.log(`       ${c.chunk.content.slice(0, 100).replace(/\n/g, ' ')}...`);
}

// ── 5. LLM rerank via Moonshot ────────────────────────────────
const pluginData = JSON.parse(await fs.readFile(join(PLUGIN_DIR, 'data.json'), 'utf8'));
const provider = pluginData.providers[0];

const SYSTEM_PROMPT = [
  '你是检索相关性评分器。',
  '针对用户问题,判断每段笔记的相关性。',
  '输出 JSON 数组,按相关性降序,给出所有候选的序号(index,即用户消息中 [N] 的 N)和 0-10 评分。',
].join('\n');

const userLines = [`问题:${query}`, '候选:'];
candidates.forEach((c, i) => {
  const truncated = c.chunk.content.length > 300 ? c.chunk.content.slice(0, 300) + '…' : c.chunk.content;
  userLines.push(`[${i + 1}] 标题: ${c.chunk.headingText || '(无)'}`);
  userLines.push(`    内容: ${truncated}`);
});
userLines.push('');
userLines.push('返回严格 JSON:{"rankings":[{"index":N,"score":0-10}, ...]}');

console.log('\n─── Calling Moonshot LLM for rerank ───');
const url = `${provider.baseUrl}/chat/completions`;
console.log(`POST ${url}  model=${provider.defaultModel}  candidates=${candidates.length}`);

const startMs = Date.now();
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  },
  body: JSON.stringify({
    model: provider.defaultModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userLines.join('\n') },
    ],
    max_tokens: 8000,
    response_format: { type: 'json_object' },
  }),
});
const latencyMs = Date.now() - startMs;

if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.log(`HTTP ${res.status} (${latencyMs}ms): ${text.slice(0, 500)}`);
  process.exit(1);
}

const json = await res.json();
const rawContent = json.choices?.[0]?.message?.content ?? '';
console.log(`Response (${latencyMs}ms, usage=${JSON.stringify(json.usage)}):`);
console.log(`finish_reason: ${json.choices?.[0]?.finish_reason}`);
console.log(`message keys: ${Object.keys(json.choices?.[0]?.message ?? {}).join(', ')}`);
console.log(`content length: ${rawContent.length}`);
console.log(`Raw: ${rawContent.slice(0, 500)}${rawContent.length > 500 ? '...' : ''}`);

let rankings = null;
try {
  const parsed = JSON.parse(rawContent);
  if (Array.isArray(parsed?.rankings)) rankings = parsed.rankings;
} catch {
  const m = rawContent.match(/\{[\s\S]*\}/);
  if (m) try { const p = JSON.parse(m[0]); if (Array.isArray(p?.rankings)) rankings = p.rankings; } catch {}
}

if (!rankings) {
  console.log('\n[FALLBACK] Failed to parse rankings, returning BM25 order');
  process.exit(0);
}

// Apply rankings
const seen = new Set();
const reranked = [];
for (const r of rankings) {
  const idx = Number(r.index);
  if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) continue;
  if (seen.has(idx - 1)) continue;
  seen.add(idx - 1);
  reranked.push({ ...candidates[idx - 1], rerankScore: typeof r.score === 'number' ? r.score : 0 });
}
candidates.forEach((c, i) => { if (!seen.has(i)) reranked.push({ ...c, rerankScore: -1 }); });

console.log('\n─── FINAL ranked results (BM25 + LLM rerank) ───');
for (let i = 0; i < Math.min(10, reranked.length); i++) {
  const r = reranked[i];
  console.log(`#${i+1}  rerank=${r.rerankScore}  bm25=${r.bm25Score.toFixed(2)}  ${r.chunk.headingText || r.chunk.filePath}`);
  console.log(`       ${r.chunk.content.slice(0, 100).replace(/\n/g, ' ')}...`);
}
