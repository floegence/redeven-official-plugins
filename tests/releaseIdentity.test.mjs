import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
const execute = promisify(execFile);

test('release readback binds generated plugin and publisher identities after build', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'official-release-identity-'));
  try {
    for (const directory of ['scripts/lib', 'plugins/example', 'dist/example/1.2.0', 'bin']) await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(root, 'scripts/release.mjs'), await readFile(new URL('../scripts/release_official_plugin.mjs', import.meta.url)));
    await writeFile(path.join(root, 'scripts/lib/officialPlugins.mjs'), `
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const repoRootFrom = () => process.cwd();
export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
export const loadPluginSource = async (root) => ({ pluginRoot: root + '/plugins/example', manifest: JSON.parse(await readFile(root + '/plugins/example/manifest.json')) });
`);
    const manifest = { publisher: { publisher_id: 'github.repo.42' }, plugin: { plugin_id: 'github.repo.42.example', version: '1.2.0' } };
    await writeFile(path.join(root, 'plugins/example/manifest.json'), JSON.stringify({ ...manifest, plugin: { ...manifest.plugin, plugin_id: 'old.example' } }));
    await writeFile(path.join(root, 'scripts/build_official_plugin.mjs'), `import { writeFile } from 'node:fs/promises'; await writeFile('plugins/example/manifest.json', ${JSON.stringify(JSON.stringify(manifest))});`);
    await writeFile(path.join(root, 'bin/npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const bytes = Buffer.from('exact-package');
    const metadata = { package_file: 'example-1.2.0.redevplugin', plugin_id: manifest.plugin.plugin_id, version: '1.2.0', size: bytes.length,
      archive_sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), package_sha256: 'a', manifest_sha256: 'b', entries_sha256: 'c' };
    await writeFile(path.join(root, 'dist/example/1.2.0/example-1.2.0.redevplugin'), bytes);
    await writeFile(path.join(root, 'dist/example/1.2.0/example-1.2.0.metadata.json'), JSON.stringify(metadata));
    await writeFile(path.join(root, 'scripts/lib/platform.mjs'), `export const platformCLI = async () => (${JSON.stringify({ ...metadata, publisher_id: 'github.repo.42' })});`);
    const options = { cwd: root, env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` } };
    const result = await execute(process.execPath, ['scripts/release.mjs', 'build', 'example'], options);
    assert.equal(JSON.parse(result.stdout).plugin_id, manifest.plugin.plugin_id);
    await writeFile(path.join(root, 'scripts/lib/platform.mjs'), `export const platformCLI = async () => (${JSON.stringify({ ...metadata, publisher_id: 'github.repo.99' })});`);
    await assert.rejects(execute(process.execPath, ['scripts/release.mjs', 'verify', 'example'], options), /release artifact readback differs/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
