import { copyFileSync, statSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Vault resolution priority:
//   1) Positional CLI args: `node scripts/deploy.mjs <vault1> <vault2> ...`
//   2) Env var `OBSIDIAN_VAULTS` (semicolon-separated) or `OBSIDIAN_VAULT` (single path)
//   3) `.deploy-vaults.json` next to this script (gitignored), array of vault paths
const argVaults = process.argv.slice(2).filter(a => !a.startsWith('-'));
const envRaw = process.env.OBSIDIAN_VAULTS || process.env.OBSIDIAN_VAULT || '';
const envVaults = envRaw.split(';').map(s => s.trim()).filter(Boolean);

let fileVaults = [];
const configPath = new URL('.deploy-vaults.json', import.meta.url);
if (existsSync(configPath)) {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    if (Array.isArray(parsed)) fileVaults = parsed.filter(s => typeof s === 'string');
  } catch (e) {
    console.error(`could not parse .deploy-vaults.json: ${e.message}`);
  }
}

const vaults = argVaults.length ? argVaults : envVaults.length ? envVaults : fileVaults;
if (!vaults.length) {
  console.error('No vault paths provided. Pass them as CLI args, set OBSIDIAN_VAULTS, or create scripts/.deploy-vaults.json (array of paths).');
  process.exit(1);
}

const src = process.cwd();
const files = [
  'main.js', 'manifest.json', 'styles.css',
  'extractor.worker.js', 'embedding.worker.js',
  'ort-wasm.wasm', 'ort-wasm-simd.wasm',
];

// Verify build artifacts once up-front — fail fast before partial deploy.
for (const f of files) {
  if (!existsSync(join(src, f))) {
    console.error(`missing build artifact: ${f} (run 'npm run build' first)`);
    process.exit(1);
  }
}

let failed = 0;
// Plugin folder name inside `.obsidian/plugins/`. Defaults to manifest.id but
// users can override via env in case they renamed the install folder.
const pluginId = process.env.PLUGIN_ID
  || JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')).id;

for (const vault of vaults) {
  const dst = join(vault, '.obsidian', 'plugins', pluginId);
  console.log(`\n→ ${dst}`);
  if (!existsSync(vault)) {
    console.warn(`  vault not found, skipping: ${vault}`);
    failed++;
    continue;
  }
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const f of files) {
    const to = join(dst, f);
    copyFileSync(join(src, f), to);
    console.log(`  ${f.padEnd(24)} ${statSync(to).size.toString().padStart(10)} bytes`);
  }
}

console.log(`\ndeployed to ${vaults.length - failed}/${vaults.length} vault(s)`);
if (failed > 0) process.exit(1);
