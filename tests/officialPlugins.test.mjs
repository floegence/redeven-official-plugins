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
  it('keeps Containers source, icon, and generated client in this repository', async () => {
    const [containers] = await loadAllPluginSources(repoRoot);
    assert.equal(containers.manifest.schema_version, 'redevplugin.manifest.v7');
    assert.equal(containers.manifest.plugin.plugin_id, 'com.redeven.official.containers');
    assert.equal(containers.manifest.plugin.version, '4.0.0');
    assert.equal(containers.manifest.surfaces[0].icon, 'ui/assets/containers-plugin.png');
    assert.equal(containers.release.package_assets['ui/assets/containers-plugin.png'], 'assets/containers-plugin.png');
    assert.deepEqual(await validatePluginSource(containers), []);

    const sources = await Promise.all([
      readFile(path.join(containers.pluginRoot, 'src', 'controller.ts'), 'utf8'),
      readFile(path.join(containers.pluginRoot, 'src', 'model.ts'), 'utf8'),
      readFile(path.join(containers.pluginRoot, 'src', 'generated', 'redeven.container_resources.v4.client.ts'), 'utf8'),
    ]);
    assert.match(sources[0], /\.\/generated\/redeven\.container_resources\.v4\.client/u);
    const joinedSources = sources.join('\n');
    assert.equal(joinedSources.includes('candidate-containers'), false);
    assert.equal(joinedSources.includes('../../../../spec'), false);
    assert.equal(joinedSources.includes('/Users/'), false);
  });

  it('keeps development source separate from the signed stable catalog', async () => {
    const [containers] = await loadAllPluginSources(repoRoot);
    assert.equal(containers.release.channel, 'development');
    assert.equal(containers.release.source_version, '4.0.0');
    assert.equal(containers.release.installable, false);
    assert.equal(containers.release.stable_catalog.version, '1.0.0');

    const catalog = buildCatalogSeed([containers]);
    assert.equal(catalog.plugins[0].latest_version, '1.0.0');
    assert.equal(catalog.plugins[0].stable_version, '1.0.0');
    assert.equal(catalog.plugins[0].default_surface_id, 'containers.activity');
    assert.equal(catalog.plugins[0].distribution.official_artifact_path, 'official/containers/1.0.0/containers-1.0.0.redevplugin');
  });

  it('generates the committed catalog deterministically', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    const expected = buildCatalogSeed(sources);
    const actual = await readJSON(path.join(repoRoot, 'catalog', 'official-catalog.seed.json'));
    assert.equal(stableJSONString(actual), stableJSONString(expected));
  });

  it('uses released ReDevPlugin dependencies without sibling wiring', async () => {
    const [rootPackage, pluginPackage, buildScript, readme] = await Promise.all([
      readFile(path.join(repoRoot, 'package.json'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'package.json'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'build_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'README.md'), 'utf8'),
    ]);
    assert.equal(buildScript.includes('redevplugin@${redevpluginVersion}'), true);
    assert.equal(buildScript.includes("const redevpluginVersion = 'v0.6.20'"), true);
    assert.doesNotMatch(`${rootPackage}\n${pluginPackage}`, /"(?:file|link|workspace|portal):/u);
    assert.doesNotMatch(readme, /Install from URL|Install from file|marketplace/iu);
  });
});
