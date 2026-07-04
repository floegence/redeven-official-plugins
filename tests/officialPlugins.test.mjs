import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  buildCatalogSeed,
  loadAllPluginSources,
  readJSON,
  repoRootFrom,
  stableJSONString,
  validatePluginSource,
} from '../scripts/lib/officialPlugins.mjs';

const repoRoot = repoRootFrom(import.meta.url);

describe('official plugin repository contract', () => {
  it('documents the official-only boundary in AGENTS.md', async () => {
    const agents = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    assert.match(agents, /First-party plugins only/);
    assert.match(agents, /Do not use `go\.work`/);
    assert.match(agents, /released ReDevPlugin CLI\/SDK\/contract/);
    assert.match(agents, /Do not create `backup\/\*` branches/);
  });

  it('keeps source manifests valid for the official namespace', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    assert.equal(sources.length, 1);
    const [containers] = sources;
    assert.equal(containers.name, 'containers');
    assert.equal(containers.manifest.publisher.publisher_id, 'com.redeven.official');
    assert.equal(containers.manifest.plugin.plugin_id, 'com.redeven.official.containers');
    assert.equal(containers.manifest.surfaces[0].entry, 'ui/index.html');
    assert.deepEqual(await validatePluginSource(containers), []);
  });

  it('generates the catalog seed from plugin manifests', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    const expected = buildCatalogSeed(sources);
    const actual = await readJSON(path.join(repoRoot, 'catalog', 'official-catalog.seed.json'));
    assert.equal(stableJSONString(actual), stableJSONString(expected));
    assert.equal(actual.plugins[0].min_redeven_version, '0.1.0');
    assert.equal(actual.plugins[0].min_redevplugin_version, '0.1.1');
    assert.equal(actual.plugins[0].distribution.requires_host_distribution_install_api, true);
  });

  it('does not expose third-party or unsigned local install entries', async () => {
    const allText = await Promise.all([
      readFile(path.join(repoRoot, 'README.md'), 'utf8'),
      readFile(path.join(repoRoot, 'catalog', 'official-catalog.seed.json'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'README.md'), 'utf8'),
    ]);
    const joined = allText.join('\n');
    assert.doesNotMatch(joined, /Install from URL|Install from file|Developer Mode|marketplace/i);
    assert.doesNotMatch(joined, /\.\.\/redevplugin|\.\.\/redeven/);
  });
});
