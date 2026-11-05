import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildCatalogSeed,
  loadAllPluginSources,
  readJSON,
  repoRootFrom,
  stableJSONString,
  validatePluginCollection,
  validatePluginSource,
} from './lib/officialPlugins.mjs';

const repoRoot = repoRootFrom(import.meta.url);
const sources = await loadAllPluginSources(repoRoot);
const errors = [];

errors.push(...validatePluginCollection(sources));

const index = await readJSON(path.join(repoRoot, '.redevplugin', 'index.json'));
const target = index.targets.find((item) => item.ecosystem === 'redevplugin' && item.host === 'redeven');
if (!target || target.plugins.length !== sources.length) {
  errors.push('repository index must list every official plugin exactly once');
} else {
  for (const source of sources) {
    const entries = target.plugins.filter((entry) => entry.plugin_id === source.manifest.plugin.plugin_id);
    const entry = entries[0];
    if (entries.length !== 1 || entry.path !== `plugins/${source.name}` || entry.manifest !== 'manifest.json' ||
      entry.release.tag_template.replace('{version}', source.manifest.plugin.version) !== source.release.release_train_tag ||
      entry.release.package_asset_template.replace('{version}', source.manifest.plugin.version) !== source.release.stable_catalog.artifact_name ||
      entry.release.release_ref_asset_template.replace('{version}', source.manifest.plugin.version) !== source.release.stable_catalog.release_ref_asset_name) {
      errors.push(`${source.name}: repository index does not match the plugin source and release`);
    }
  }
}

for (const source of sources) {
  errors.push(...await validatePluginSource(source));
}

const agents = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
for (const phrase of [
  'First-party plugins only',
  'Do not use `go.work`',
  'Do not import or copy source from `../redeven` or `../redevplugin`',
  'released ReDevPlugin CLI/SDK/contract',
]) {
  if (!agents.includes(phrase)) {
    errors.push(`AGENTS.md must contain: ${phrase}`);
  }
}

const seedPath = path.join(repoRoot, 'catalog', 'official-catalog.seed.json');
const seed = await readJSON(seedPath);
const expected = buildCatalogSeed(sources);
if (stableJSONString(seed) !== stableJSONString(expected)) {
  errors.push('catalog/official-catalog.seed.json is not synchronized; run npm run catalog:write');
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`official plugin check: ${error}`);
  }
  process.exit(1);
}

console.log(`official plugin check: ${sources.length} plugin source(s) verified`);
