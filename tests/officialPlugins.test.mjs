import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {
  loadAllPluginSources,
  readJSON,
  repoRootFrom,
  resolvePluginForReleaseTag,
  stableJSONString,
  validatePluginCollection,
  validatePluginSource,
} from '../scripts/lib/officialPlugins.mjs';

const repoRoot = repoRootFrom(import.meta.url);

describe('official plugin repository contract', () => {
  it('requires independent ordinary-package release namespaces', async () => {
    const index = await readJSON(path.join(repoRoot, '.redevplugin', 'index.json'));
    for (const entry of index.targets[0].plugins) {
      assert.match(entry.release.tag_template, /^[a-z0-9]+(?:-[a-z0-9]+)*-v\{version\}$/);
      assert.deepEqual(Object.keys(entry.release).sort(), ['package_asset_template', 'tag_template']);
    }
  });
  it('lists each plugin in the repository discovery entry', async () => {
    const index = await readJSON(path.join(repoRoot, '.redevplugin', 'index.json'));
    const sources = await loadAllPluginSources(repoRoot);
    assert.equal(index.schema_version, 'redevplugin.repository-index.v1');
    const target = index.targets.find((item) => item.ecosystem === 'redevplugin' && item.host === 'redeven');
    assert.ok(target);
    assert.deepEqual(target.plugins.map((item) => item.plugin_id).sort(), sources.map((source) => source.manifest.plugin.plugin_id).sort());
    for (const source of sources) {
      const entry = target.plugins.find((item) => item.plugin_id === source.manifest.plugin.plugin_id);
      assert.equal(entry.path, `plugins/${source.name}`);
      assert.equal(entry.manifest, 'manifest.json');
      for (const [template, actual] of [
        [entry.release.tag_template, source.release.release_train_tag],
        [entry.release.package_asset_template, `${source.name}-${source.manifest.plugin.version}.redevplugin`],
      ]) assert.equal(template.replace('{version}', source.manifest.plugin.version), actual);
    }
  });
  it('publishes Weather and Mind Map as current official plugin sources', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    assert.deepEqual(sources.map(({ name }) => name), ['mind-map', 'weather']);
    const weather = sources.find(({ name }) => name === 'weather');
    const mindMap = sources.find(({ name }) => name === 'mind-map');
    assert.ok(weather);
    assert.ok(mindMap);
    assert.equal(weather.name, 'weather');
    assert.equal(weather.manifest.schema_version, 'redevplugin.manifest.v9');
    assert.equal(weather.manifest.plugin.plugin_id, 'github.repo.1289352675.weather');
    assert.equal(weather.manifest.plugin.version, '1.2.0');
    assert.deepEqual(weather.manifest.permissions, ['network.client']);
    assert.deepEqual(weather.manifest.api.required_features, ['net.http.v1']);
    assert.equal(weather.manifest.presentation.icon.path, 'ui/assets/weather-plugin.png');
    assert.equal(weather.manifest.surfaces[0].surface_id, 'weather.dashboard');
    assert.equal(mindMap.manifest.schema_version, 'redevplugin.manifest.v9');
    assert.equal(mindMap.manifest.plugin.plugin_id, 'github.repo.1289352675.mind-map');
    assert.equal(mindMap.manifest.plugin.version, '1.2.0');
    assert.deepEqual(mindMap.manifest.permissions, []);
    assert.deepEqual(mindMap.manifest.api.required_features, []);
    assert.equal(mindMap.manifest.workers[0].scope, 'user');
    assert.equal(mindMap.manifest.workers[0].artifact, 'workers/mind-map.wasm');
    assert.deepEqual(mindMap.manifest.methods.map(({ method }) => method), [
      'mindmap.workspace.load',
      'mindmap.workspace.save',
      'mindmap.document.read',
      'mindmap.document.edit',
    ]);
    assert.equal(mindMap.manifest.storage.stores[0].quota_bytes, 4 * 1024 * 1024);
    assert.equal(mindMap.manifest.surfaces[0].surface_id, 'mind-map.editor');
  });

  it('ignores build residue that has no plugin source entrypoint', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'redeven-official-plugins-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const residue = path.join(root, 'plugins', 'retired', 'dist');
    await mkdir(residue, { recursive: true });
    await writeFile(path.join(residue, 'manifest.json'), '{}\n');
    assert.deepEqual(await loadAllPluginSources(root), []);
  });

  it('resolves each global release tag to exactly one plugin', async () => {
    const sources = await loadAllPluginSources(repoRoot);
    assert.equal(resolvePluginForReleaseTag(sources, 'weather-v1.2.0').name, 'weather');
    assert.equal(resolvePluginForReleaseTag(sources, 'mind-map-v1.2.0').name, 'mind-map');
    assert.throws(() => resolvePluginForReleaseTag(sources, 'v9.9.9'), /exactly one plugin/u);

    const duplicate = structuredClone(sources[0]);
    duplicate.name = 'duplicate';
    assert.throws(
      () => resolvePluginForReleaseTag([...sources, duplicate], sources[0].release.release_train_tag),
      /exactly one plugin/u,
    );
    assert.match(validatePluginCollection([...sources, duplicate]).join('\n'), /duplicate release tag/u);
  });

  it('resolves independent plugin tags at the same version without mixing assets', async () => {
    const sources = structuredClone(await loadAllPluginSources(repoRoot));
    for (const source of sources) {
      source.manifest.plugin.version = '2.0.0';
      source.packageJSON.version = '2.0.0';
      source.release.source_version = '2.0.0';
      source.release.release_train_tag = `${source.name}-v2.0.0`;
    }
    assert.deepEqual(validatePluginCollection(sources), []);
    for (const source of sources) assert.deepEqual(await validatePluginSource(source), []);
    assert.equal(resolvePluginForReleaseTag(sources, 'weather-v2.0.0').name, 'weather');
    assert.equal(resolvePluginForReleaseTag(sources, 'mind-map-v2.0.0').name, 'mind-map');
    assert.throws(() => resolvePluginForReleaseTag(sources, 'v2.0.0'), /exactly one plugin/u);

  });

  it('derives release versions from the selected manifest for publish and recovery', async () => {
    for (const filename of ['scripts/publish_official_plugin_release.sh', '.github/workflows/release.yml', '.github/workflows/recover-release.yml']) {
      const content = await readFile(path.join(repoRoot, filename), 'utf8');
      assert.doesNotMatch(content, /\$\{(?:tag|GITHUB_REF_NAME|RELEASE_TAG)#v\}/u);
      assert.match(content, /version=.*plugin\.version/u);
    }
    const workflow = await readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
    assert.ok(workflow.includes("'*-v*'"));
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
    assert.match(buildScript, /platformCLI/u);
    assert.match(releaseScript, /<plugin-name>/u);
    assert.doesNotMatch(releaseScript, /apply-signature|publisher-config|release-ref/u);
    assert.match(releaseScript, /'release', 'inspect'/u);
    assert.doesNotMatch(releaseScript, /WEATHER_RELEASE_WASM|pluginName === ['"]weather['"]/u);
    assert.match(canonicalBuildScript, /linux\/amd64/u);
    assert.match(canonicalBuildScript, /rust:1\.98\.0-bookworm@sha256:/u);
    assert.match(releaseWorkflow, /resolve_release_plugin\.mjs/u);
    assert.match(releaseWorkflow, /plugins\/\*\/package-lock\.json/u);
    assert.match(recoveryWorkflow, /unchanged package source/u);
    assert.match(recoveryWorkflow, /git diff --quiet/u);
    assert.match(publishScript, /release:verify/u);
    assert.match(publishScript, /resolve_release_plugin\.mjs/u);
    assert.doesNotMatch(publishScript, /plugin="weather"/u);
    assert.match(rootPackage, /build:weather/u);
    assert.match(rootPackage, /build:mind-map/u);
    assert.match(readme, /Weather/u);
    assert.match(readme, /Mind Map/u);
    assert.doesNotMatch(`${rootPackage}\n${readme}\n${agents}`, /com\.redeven\.official\.containers|package:containers/u);
    assert.doesNotMatch(`${rootPackage}\n${buildScript}\n${releaseScript}`, /"(?:file|link|workspace|portal):/u);
    assert.doesNotMatch(`${buildScript}\n${releaseScript}`, /private_key_file|SIGNING_KEY/iu);
    assert.doesNotMatch(tracked, /(?:plugins|releases)\/containers\//u);
    assert.doesNotMatch(tracked, /^plugins\/pocket-pounce\//mu);
    assert.doesNotMatch(tracked, /\.redevplugin$/mu);
    assert.doesNotMatch(tracked, /^releases\//mu);
  });
});
