import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildCatalogSeed,
  loadAllPluginSources,
  repoRootFrom,
  stableJSONString,
} from './lib/officialPlugins.mjs';

const repoRoot = repoRootFrom(import.meta.url);
const seedPath = path.join(repoRoot, 'catalog', 'official-catalog.seed.json');
const catalog = buildCatalogSeed(await loadAllPluginSources(repoRoot));
const next = stableJSONString(catalog);
const args = new Set(process.argv.slice(2));

if (args.has('--write')) {
  await writeFile(seedPath, next);
  console.log(`wrote ${path.relative(repoRoot, seedPath)}`);
} else if (args.has('--verify')) {
  const current = await readFile(seedPath, 'utf8');
  if (current !== next) {
    console.error('official catalog seed is stale; run npm run catalog:write');
    process.exit(1);
  }
  console.log('official catalog seed is current');
} else {
  process.stdout.write(next);
}
