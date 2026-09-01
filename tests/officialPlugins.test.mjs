import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {
  buildCatalogSeed,
  loadAllPluginSources,
  readJSON,
  repoRootFrom,
  resolvePluginForReleaseTag,
  stableJSONString,
  validatePluginCollection,
} from '../scripts/lib/officialPlugins.mjs';

const repoRoot = repoRootFrom(import.meta.url);

describe('official plugin repository contract', () => {
  it('publishes Weather and Pocket Pounce as current official plugin sources', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    assert.deepEqual(sources.map(({ name }) => name), ['pocket-pounce', 'weather']);
    const weather = sources.find(({ name }) => name === 'weather');
    const pocketPounce = sources.find(({ name }) => name === 'pocket-pounce');
    assert.ok(weather);
    assert.ok(pocketPounce);
    assert.equal(weather.name, 'weather');
    assert.equal(weather.manifest.schema_version, 'redevplugin.manifest.v9');
    assert.equal(weather.manifest.plugin.plugin_id, 'com.redeven.official.weather');
    assert.equal(weather.manifest.plugin.version, '1.0.9');
    assert.deepEqual(weather.manifest.permissions, ['network.client']);
    assert.deepEqual(weather.manifest.api.required_features, ['net.http.v1']);
    assert.equal(weather.manifest.presentation.icon.path, 'ui/assets/weather-plugin.png');
    assert.equal(weather.manifest.surfaces[0].surface_id, 'weather.dashboard');
    assert.equal(weather.release.stable_catalog.default_surface_id, 'weather.dashboard');
    assert.equal(weather.release.stable_catalog.min_redevplugin_version, '3.0.18');
    assert.equal(pocketPounce.manifest.schema_version, 'redevplugin.manifest.v9');
    assert.equal(pocketPounce.manifest.plugin.plugin_id, 'com.redeven.official.pocket-pounce');
    assert.equal(pocketPounce.manifest.plugin.version, '1.0.10');
    assert.deepEqual(pocketPounce.manifest.permissions, []);
    assert.deepEqual(pocketPounce.manifest.workers, []);
    assert.deepEqual(pocketPounce.manifest.methods, []);
    assert.equal(pocketPounce.manifest.surfaces[0].surface_id, 'pocket-pounce.game');
    assert.equal(pocketPounce.release.stable_catalog.min_redevplugin_version, '3.0.18');
  });

  it('ignores build residue that has no plugin source entrypoint', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'redeven-official-plugins-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const residue = path.join(root, 'plugins', 'retired', 'dist');
    await mkdir(residue, { recursive: true });
    await writeFile(path.join(residue, 'manifest.json'), '{}\n');
    assert.deepEqual(await loadAllPluginSources(root), []);
  });

  it('generates the committed multi-plugin catalog deterministically', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    const expected = buildCatalogSeed(sources);
    const actual = await readJSON(path.join(repoRoot, 'catalog', 'official-catalog.seed.json'));
    assert.deepEqual(actual.plugins.map(({ plugin_id }) => plugin_id), [
      'com.redeven.official.pocket-pounce',
      'com.redeven.official.weather',
    ]);
    assert.equal(stableJSONString(actual), stableJSONString(expected));
  });

  it('resolves each global release tag to exactly one plugin', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    assert.equal(resolvePluginForReleaseTag(sources, 'v1.0.9').name, 'weather');
    assert.equal(resolvePluginForReleaseTag(sources, 'v1.0.10').name, 'pocket-pounce');
    assert.throws(() => resolvePluginForReleaseTag(sources, 'v9.9.9'), /exactly one plugin/u);

    const duplicate = structuredClone(sources[0]);
    duplicate.name = 'duplicate';
    assert.throws(
      () => resolvePluginForReleaseTag([...sources, duplicate], sources[0].release.release_train_tag),
      /exactly one plugin/u,
    );
    assert.match(validatePluginCollection([...sources, duplicate]).join('\n'), /duplicate release tag/u);
  });

  it('keeps the reusable plugin packaging and release framework', async () => {
    const [rootPackage, buildScript, releaseScript, canonicalBuildScript, releaseWorkflow, recoveryWorkflow, publishScript, readme, agents, tracked] = await Promise.all([
      readFile(path.join(repoRoot, 'package.json'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'build_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'release_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'build_weather_release_wasm.sh'), 'utf8'),
      readFile(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8'),
      readFile(path.join(repoRoot, '.github', 'workflows', 'recover-release.yml'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'publish_official_plugin_release.sh'), 'utf8'),
      readFile(path.join(repoRoot, 'README.md'), 'utf8'),
      readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8'),
      import('node:child_process').then(({ execFileSync }) => execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })),
    ]);

    assert.match(buildScript, /<plugin-name>/u);
    assert.match(buildScript, /redevplugin\/v3\/cmd\/redevplugin/u);
    assert.match(releaseScript, /<plugin-name>/u);
    assert.match(releaseScript, /apply-signature/u);
    assert.doesNotMatch(releaseScript, /WEATHER_RELEASE_WASM|pluginName === ['"]weather['"]/u);
    assert.match(canonicalBuildScript, /linux\/amd64/u);
    assert.match(canonicalBuildScript, /rust:1\.88-bookworm@sha256:/u);
    assert.match(releaseWorkflow, /resolve_release_plugin\.mjs/u);
    assert.match(releaseWorkflow, /plugins\/\*\/package-lock\.json/u);
    assert.match(recoveryWorkflow, /unchanged package source/u);
    assert.match(recoveryWorkflow, /git diff --quiet/u);
    assert.match(publishScript, /release:verify/u);
    assert.match(publishScript, /resolve_release_plugin\.mjs/u);
    assert.doesNotMatch(publishScript, /plugin="weather"/u);
    assert.match(rootPackage, /build:weather/u);
    assert.match(rootPackage, /build:pocket-pounce/u);
    assert.match(readme, /Weather/u);
    assert.doesNotMatch(`${rootPackage}\n${readme}\n${agents}`, /com\.redeven\.official\.containers|package:containers/u);
    assert.doesNotMatch(`${rootPackage}\n${buildScript}\n${releaseScript}`, /"(?:file|link|workspace|portal):/u);
    assert.doesNotMatch(`${buildScript}\n${releaseScript}`, /private_key_file|SIGNING_KEY/iu);
    assert.doesNotMatch(tracked, /(?:plugins|releases)\/containers\//u);
    assert.doesNotMatch(tracked, /\.redevplugin$/mu);
    const weatherReleaseInputs = [...tracked.matchAll(/^releases\/weather\/([^/]+)\//gmu)].map((match) => match[1]);
    assert.deepEqual([...new Set(weatherReleaseInputs)], ['1.0.9']);
  });
});
