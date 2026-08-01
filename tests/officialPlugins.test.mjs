import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
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

  it('keeps the release train and current catalog aligned at Containers 4.0.0', async () => {
    const [containers] = await loadAllPluginSources(repoRoot);
    assert.equal(containers.release.channel, 'stable');
    assert.equal(containers.release.source_version, '4.0.0');
    assert.equal(containers.release.release_train_tag, 'v4.0.0');
    assert.equal(containers.release.stable_catalog.version, '4.0.0');

    const catalog = buildCatalogSeed([containers]);
    assert.equal(catalog.plugins[0].latest_version, '4.0.0');
    assert.equal(catalog.plugins[0].stable_version, '4.0.0');
    assert.equal(catalog.plugins[0].default_surface_id, 'containers.dashboard');
    assert.deepEqual(catalog.plugins[0].distribution, {
      provider: 'github_release',
      repository: 'floegence/redeven-official-plugins',
      tag: 'v4.0.0',
      artifact_name: 'containers-4.0.0.redevplugin',
      release_ref_asset_name: 'containers-4.0.0.release-ref.json',
      trust_root_asset_name: 'root.public.json',
    });
  });

  it('generates the committed catalog deterministically', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    const expected = buildCatalogSeed(sources);
    const actual = await readJSON(path.join(repoRoot, 'catalog', 'official-catalog.seed.json'));
    assert.equal(stableJSONString(actual), stableJSONString(expected));
  });

  it('uses released ReDevPlugin dependencies without sibling wiring', async () => {
    const [rootPackage, pluginPackage, buildScript, readme, agents] = await Promise.all([
      readFile(path.join(repoRoot, 'package.json'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'package.json'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'build_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'README.md'), 'utf8'),
      readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8'),
    ]);
    assert.equal(buildScript.includes('redevplugin@${redevpluginVersion}'), true);
    assert.equal(buildScript.includes("const redevpluginVersion = 'v0.6.21'"), true);
    assert.doesNotMatch(`${rootPackage}\n${pluginPackage}`, /"(?:file|link|workspace|portal):/u);
    assert.doesNotMatch(readme, /Install from URL|Install from file|marketplace/iu);
    assert.doesNotMatch(`${buildScript}\n${readme}\n${agents}`, /REDEVEN_OFFICIAL_PLUGIN_SIGNING_KEY/u);
  });

  it('keeps packages out of git and uses neutral external signer exchange', async () => {
    const [packageScript, releaseScript, publisherConfig, capabilityPin, buildScript, releaseWorkflow, responses, tracked] = await Promise.all([
      readFile(path.join(repoRoot, 'scripts', 'build_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'release_official_plugin.mjs'), 'utf8'),
      readJSON(path.join(repoRoot, 'releases', 'containers', '4.0.0', 'publisher-config.json')),
      readJSON(path.join(repoRoot, 'plugins', 'containers', 'host-capability.pin.json')),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'build.mjs'), 'utf8'),
      readFile(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8'),
      readdir(path.join(repoRoot, 'releases', 'containers', '4.0.0', 'responses')),
      import('node:child_process').then(({ execFileSync }) => execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })),
    ]);
    assert.doesNotMatch(tracked, /\.redevplugin$/mu);
    assert.doesNotMatch(packageScript, /private_key_file|SIGNING_KEY|secret/iu);
    assert.match(releaseScript, /apply-signature/u);
    assert.match(releaseScript, /release', 'verify/u);
    assert.equal(publisherConfig.schema_version, 'redevplugin.release_publisher_config.v1');
    assert.equal(publisherConfig.min_redevplugin_version, '0.6.21');
    assert.equal(publisherConfig.host_requirements[0].required_capability_contracts[0].contract.artifact_sha256, capabilityPin.artifact_sha256);
    assert.equal(capabilityPin.contract_id, 'redeven.container_resources.v4');
    assert.match(buildScript, /capabilityMethods\.length !== 52/u);
    assert.equal(responses.filter((name) => name.endsWith('.response.json')).length, 15);
    assert.match(releaseWorkflow, /remote_main.*GITHUB_SHA/su);
    assert.doesNotMatch(releaseWorkflow, /repos\/\$GITHUB_REPOSITORY\/immutable-releases/u);
    assert.match(releaseWorkflow, /gh release create/u);
    assert.match(releaseWorkflow, /diff -qr/u);
    assert.match(releaseWorkflow, /npm run release:verify/u);
  });
});
