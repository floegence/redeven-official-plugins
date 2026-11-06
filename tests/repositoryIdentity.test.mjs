import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildProject } from '../scripts/lib/authorProject.mjs';

test('local builds use the offline released project pipeline', async () => {
  const calls = [];
  await buildProject('/repo/plugins/weather', false, async (...args) => calls.push(args));
  assert.deepEqual(calls, [[['build', '/repo/plugins/weather'], { env: { REDEVPLUGIN_OFFICIAL_RELEASE: '0' } }]]);
});

test('release builds resolve identity within the platform before author commands', async () => {
  const calls = [];
  await buildProject('/repo/plugins/weather', true, async (...args) => calls.push(args));
  assert.deepEqual(calls, [[['build', '/repo/plugins/weather', '--release'], { env: { REDEVPLUGIN_OFFICIAL_RELEASE: '1' } }]]);
});

test('editable source and index carry only slugs', async () => {
  for (const name of ['weather', 'mind-map']) {
    const source = JSON.parse(await readFile(new URL(`../plugins/${name}/manifest.json`, import.meta.url)));
    assert.equal(source.schema_version, 'redevplugin.source.v1');
    assert.equal(source.plugin.slug, name);
    assert.equal(source.plugin.plugin_id, undefined);
    assert.equal(source.publisher?.publisher_id, undefined);
  }
  const index = JSON.parse(await readFile(new URL('../.redevplugin/index.json', import.meta.url)));
  assert.deepEqual(index.targets[0].plugins.map(p => p.slug).sort(), ['mind-map', 'weather']);
  assert.ok(index.targets[0].plugins.every(p => !('plugin_id' in p)));
});

test('readback compiles source in isolation and compares the canonical manifest hash', async () => {
  const { expectedManifest } = await import('../scripts/lib/authorProject.mjs');
  const { writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  let temporary;
  const expected = await expectedManifest('/repo/plugins/weather', true, async args => {
    assert.deepEqual(args.slice(0, 2), ['generate', '/repo/plugins/weather/manifest.json']);
    assert.equal(args[3], '--release');
    temporary = args[2];
    assert.ok(!temporary.startsWith('/repo/'));
    await writeFile(path.join(temporary, 'manifest.json'), JSON.stringify({ plugin: { plugin_id: 'github.repo.42.weather', version: '1.3.0' }, publisher: { publisher_id: 'github.repo.42' } }));
    await writeFile(path.join(temporary, 'source-map.json'), JSON.stringify({ manifest_sha256: 'a'.repeat(64) }));
  });
  assert.deepEqual(expected, { plugin_id: 'github.repo.42.weather', publisher_id: 'github.repo.42', version: '1.3.0', manifest_sha256: `sha256:${'a'.repeat(64)}` });
  await assert.rejects(readFile(path.join(temporary, 'manifest.json')), { code: 'ENOENT' });
});
