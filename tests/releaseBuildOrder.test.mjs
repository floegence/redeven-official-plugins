import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

for (const name of ['mind-map', 'weather']) {
  test(`${name} canonical Worker and UI use the already compiled release identity`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'official-release-order-'));
    try {
      const pluginRoot = path.join(root, 'plugins', name);
      for (const directory of ['scripts', `plugins/${name}/scripts`, `plugins/${name}/generated`, 'bin']) await mkdir(path.join(root, directory), { recursive: true });
      await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      const source = JSON.stringify({ plugin: { slug: name, version: '1.3.0' } });
      await writeFile(path.join(pluginRoot, 'manifest.json'), source);
      const generated = path.join(pluginRoot, 'generated/manifest.json');
      await writeFile(generated, JSON.stringify({ plugin: { plugin_id: `github.repo.42.${name}`, version: '1.3.0' } }));
      await writeFile(path.join(pluginRoot, 'scripts/build.mjs'), await readFile(new URL(`../plugins/${name}/scripts/build.mjs`, import.meta.url)));
      const worker = name === 'mind-map' ? path.join(pluginRoot, 'scripts/build-release-wasm.sh') : path.join(root, 'scripts/build_weather_release_wasm.sh');
      await writeFile(worker, `#!/bin/sh\nprintf 'worker\\n' >> "$ORDER_LOG"\n`, { mode: 0o755 });
      await writeFile(path.join(root, 'bin/npm'), `#!/bin/sh\nprintf 'ui\\n' >> "$ORDER_LOG"\nexit 71\n`, { mode: 0o755 });
      const log = path.join(root, 'order.log');
      const options = { env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, ORDER_LOG: log, REDEVPLUGIN_OFFICIAL_RELEASE: '1' } };
      const script = path.join(pluginRoot, 'scripts/build.mjs');
      await assert.rejects(execute(process.execPath, [script], options), error => error.code === 71);
      assert.equal(await readFile(log, 'utf8'), 'worker\nui\n');
      assert.equal(await readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'), source);
      assert.equal(JSON.parse(await readFile(generated)).plugin.plugin_id, `github.repo.42.${name}`);
      await rm(log); await rm(generated);
      await assert.rejects(execute(process.execPath, [script], options), /ENOENT/);
      await assert.rejects(readFile(log), { code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
