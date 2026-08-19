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
    assert.equal(containers.manifest.schema_version, 'redevplugin.manifest.v9');
    assert.equal(containers.manifest.plugin.plugin_id, 'com.redeven.official.containers');
    assert.equal(containers.manifest.plugin.version, '4.4.5');
    assert.equal(containers.manifest.api.major, 1);
    assert.deepEqual(containers.manifest.permissions, []);
    assert.deepEqual(containers.manifest.workers, []);
    assert.equal(containers.manifest.presentation.locales.default, 'en-US');
    assert.equal(containers.manifest.surfaces[0].icon, 'ui/assets/containers-plugin.png');
    assert.equal(containers.manifest.presentation.icon.path, 'ui/assets/containers-plugin.png');
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
    assert.doesNotMatch(joinedSources, /PluginOperation|operation_id/u);
    assert.match(joinedSources, /PluginExecution/u);
    assert.match(joinedSources, /execution_id/u);
  });

  it('keeps the release train and current catalog aligned at Containers 4.4.5', async () => {
    const [containers] = await loadAllPluginSources(repoRoot);
    assert.equal(containers.release.channel, 'stable');
    assert.equal(containers.release.source_version, '4.4.5');
    assert.equal(containers.release.release_train_tag, 'v4.4.5');
    assert.equal(containers.release.previous_release_train_tag, 'v4.4.4');
    assert.equal(containers.release.stable_catalog.version, '4.4.5');
    assert.equal(containers.release.stable_catalog.min_redevplugin_version, '3.0.2');

    const catalog = buildCatalogSeed([containers]);
    assert.equal(catalog.plugins[0].presentation.default_locale, 'en-US');
    assert.equal(catalog.plugins[0].presentation.locales.length, 1);
    assert.deepEqual(catalog.plugins[0].presentation.locales.map((entry) => entry.locale), ['en-US']);
    assert.equal(catalog.plugins[0].presentation.locales[0].name, 'Containers');
    assert.equal(catalog.plugins[0].latest.version, '4.4.5');
    assert.equal(catalog.plugins[0].latest.min_redevplugin_version, '3.0.2');
    assert.equal(catalog.plugins[0].latest.default_surface_id, 'containers.dashboard');
    assert.deepEqual(catalog.plugins[0].latest.distribution, {
      provider: 'github_release',
      repository: 'floegence/redeven-official-plugins',
      tag: 'v4.4.5',
      artifact_name: 'containers-4.4.5.redevplugin',
      release_ref_asset_name: 'containers-4.4.5.release-ref.json',
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
    const [rootPackage, pluginPackage, buildScript, releaseScript, readme, agents] = await Promise.all([
      readFile(path.join(repoRoot, 'package.json'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'package.json'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'build_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'release_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'README.md'), 'utf8'),
      readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8'),
    ]);
    assert.equal(buildScript.includes('redevplugin@${redevpluginVersion}'), true);
    assert.match(buildScript, /redevplugin\/v3\/cmd\/redevplugin/u);
    for (const script of [buildScript, releaseScript]) {
      assert.equal(script.includes("const redevpluginVersion = 'v3.0.2'"), true);
      assert.match(script, /redevplugin\/v3\/cmd\/redevplugin/u);
      assert.match(script, /GOTOOLCHAIN: 'go1\.26\.6\+auto'/u);
    }
    assert.doesNotMatch(`${rootPackage}\n${pluginPackage}`, /"(?:file|link|workspace|portal):/u);
    assert.doesNotMatch(readme, /Install from URL|Install from file|marketplace/iu);
    assert.doesNotMatch(`${buildScript}\n${readme}\n${agents}`, /REDEVEN_OFFICIAL_PLUGIN_SIGNING_KEY/u);
  });

  it('keeps packages out of git and uses neutral external signer exchange', async () => {
    const [rootPackage, packageScript, releaseScript, publisherConfig, capabilityPin, publishScript, buildScript, releaseWorkflow, recoveryWorkflow, tracked] = await Promise.all([
      readFile(path.join(repoRoot, 'package.json'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'build_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'release_official_plugin.mjs'), 'utf8'),
      readJSON(path.join(repoRoot, 'releases', 'containers', '4.4.5', 'publisher-config.json')),
      readJSON(path.join(repoRoot, 'plugins', 'containers', 'host-capability.pin.json')),
      readFile(path.join(repoRoot, 'scripts', 'publish_official_plugin_release.sh'), 'utf8'),
      readFile(path.join(repoRoot, 'plugins', 'containers', 'build.mjs'), 'utf8'),
      readFile(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8'),
      readFile(path.join(repoRoot, '.github', 'workflows', 'recover-release.yml'), 'utf8'),
      import('node:child_process').then(({ execFileSync }) => execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })),
    ]);
    assert.doesNotMatch(tracked, /\.redevplugin$/mu);
    assert.doesNotMatch(packageScript, /private_key_file|SIGNING_KEY|secret/iu);
    assert.match(releaseScript, /apply-signature/u);
    assert.match(releaseScript, /release', 'verify/u);
    assert.doesNotMatch(releaseScript, /--previous|previousOutput/u);
    assert.equal(publisherConfig.schema_version, 'redevplugin.release_publisher_config.v1');
    assert.equal(publisherConfig.min_redevplugin_version, '3.0.2');
    assert.equal(Object.hasOwn(publisherConfig, 'signing_ledger'), false);
    assert.deepEqual(
      publisherConfig.host_requirements[0].required_capability_contracts[0].contract,
      capabilityPin,
    );
    assert.deepEqual(Object.keys(capabilityPin).sort(), [
      'artifact_sha256',
      'contract_id',
      'contract_version',
      'publisher_id',
    ]);
    assert.equal(capabilityPin.contract_id, 'redeven.container_resources.v4');
    assert.equal(capabilityPin.artifact_sha256, '0137cd99569a48d3ef4061b19b2fda021ed02cf268094b79c29a40f74bce0b92');
    assert.doesNotMatch(rootPackage, /release:stage-capability/u);
    await assert.rejects(
      readFile(path.join(repoRoot, 'scripts', 'stage_release_capability.mjs'), 'utf8'),
      (error) => error?.code === 'ENOENT',
    );
    assert.doesNotMatch(tracked, /releases\/containers\/4\.4\.5\/capability-source\.json/u);
    assert.match(buildScript, /capabilityMethods\.length !== 52/u);
    assert.match(releaseWorkflow, /remote_main.*GITHUB_SHA/su);
    assert.doesNotMatch(releaseWorkflow, /repos\/\$GITHUB_REPOSITORY\/immutable-releases/u);
    assert.match(publishScript, /gh release create/u);
    assert.match(publishScript, /diff -qr/u);
    assert.match(publishScript, /npm run release:verify/u);
    assert.doesNotMatch(publishScript, /release:stage-capability|previous_tag|previous_output/u);
    assert.match(publishScript, /npm run release:prepare -- containers/u);
    assert.doesNotMatch(`${releaseWorkflow}\n${recoveryWorkflow}\n${publishScript}`, /type f.*wc -l.*= 51/su);
    assert.match(releaseWorkflow, /publish_official_plugin_release\.sh/u);
    assert.match(releaseWorkflow, /go-version: '1\.26\.6'/u);
    assert.match(recoveryWorkflow, /go-version: '1\.26\.6'/u);
    assert.match(recoveryWorkflow, /workflow_dispatch/u);
    assert.match(recoveryWorkflow, /ref: \$\{\{ inputs\.tag \}\}/u);
    assert.match(recoveryWorkflow, /path: release-source/u);
    assert.match(recoveryWorkflow, /working-directory: release-source/u);
    assert.match(recoveryWorkflow, /merge-base --is-ancestor/u);
    assert.match(recoveryWorkflow, /head_sha.*tag_commit/su);
    assert.match(recoveryWorkflow, /publish_official_plugin_release\.sh/u);
  });
});
