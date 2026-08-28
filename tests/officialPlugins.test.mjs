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
  stableJSONString,
} from '../scripts/lib/officialPlugins.mjs';

const repoRoot = repoRootFrom(import.meta.url);

describe('official plugin repository contract', () => {
  it('supports an intentionally empty official plugin source set', async () => {
    assert.deepEqual(await loadAllPluginSources(repoRoot), []);
  });

  it('ignores build residue that has no plugin source entrypoint', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'redeven-official-plugins-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const residue = path.join(root, 'plugins', 'retired', 'dist');
    await mkdir(residue, { recursive: true });
    await writeFile(path.join(residue, 'manifest.json'), '{}\n');
    assert.deepEqual(await loadAllPluginSources(root), []);
  });

  it('generates the committed empty catalog deterministically', async () => {
    const expected = buildCatalogSeed([]);
    const actual = await readJSON(path.join(repoRoot, 'catalog', 'official-catalog.seed.json'));
    assert.deepEqual(actual.plugins, []);
    assert.equal(stableJSONString(actual), stableJSONString(expected));
  });

  it('keeps the reusable plugin packaging and release framework', async () => {
    const [rootPackage, buildScript, releaseScript, readme, agents, tracked] = await Promise.all([
      readFile(path.join(repoRoot, 'package.json'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'build_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'scripts', 'release_official_plugin.mjs'), 'utf8'),
      readFile(path.join(repoRoot, 'README.md'), 'utf8'),
      readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8'),
      import('node:child_process').then(({ execFileSync }) => execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })),
    ]);

    assert.match(buildScript, /<plugin-name>/u);
    assert.match(buildScript, /redevplugin\/v3\/cmd\/redevplugin/u);
    assert.match(releaseScript, /<plugin-name>/u);
    assert.match(releaseScript, /apply-signature/u);
    assert.doesNotMatch(`${rootPackage}\n${readme}\n${agents}`, /com\.redeven\.official\.containers|package:containers/u);
    assert.doesNotMatch(`${rootPackage}\n${buildScript}\n${releaseScript}`, /"(?:file|link|workspace|portal):/u);
    assert.doesNotMatch(`${buildScript}\n${releaseScript}`, /private_key_file|SIGNING_KEY/iu);
    assert.doesNotMatch(tracked, /(?:plugins|releases)\/containers\//u);
    assert.doesNotMatch(tracked, /publish_official_plugin_release\.sh|workflows\/(?:release|recover-release)\.yml/u);
    assert.doesNotMatch(tracked, /\.redevplugin$/mu);
  });
});
