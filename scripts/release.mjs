import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8'));
const { id, version } = manifest;

const files = [
  'manifest.json', 'main.js', 'styles.css',
  'extractor.worker.js', 'embedding.worker.js',
  'ort-wasm.wasm', 'ort-wasm-simd.wasm',
];

for (const f of files) {
  if (!existsSync(join(root, f))) {
    console.error(`missing build artifact: ${f} (run 'npm run build' first)`);
    process.exit(1);
  }
}

const entries = {};
for (const f of files) {
  entries[`${id}/${f}`] = readFileSync(join(root, f));
}

const outDir = join(root, 'releases');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${id}-${version}.zip`);

const buf = zipSync(entries, { level: 9 });
writeFileSync(outPath, buf);

const sizeMb = (statSync(outPath).size / 1024 / 1024).toFixed(2);
console.log(`\nrelease: ${outPath} (${sizeMb} MB)`);
console.log('contents:');
for (const f of files) {
  const sz = statSync(join(root, f)).size;
  console.log(`  ${id}/${f.padEnd(24)} ${sz.toString().padStart(10)} bytes`);
}
console.log(`\ninstall: unzip into <vault>/.obsidian/plugins/ then enable in Obsidian → Settings → Community plugins`);
