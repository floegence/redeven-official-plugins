import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

for (const name of ['mind-map', 'weather']) {
  test(`${name} release resolves repository identity before any build`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'official-release-order-'));
    try {
      const pluginRoot = path.join(root, 'plugins', name);
      for (const directory of ['scripts/lib', `plugins/${name}/scripts`, 'bin']) {
        await mkdir(path.join(root, directory), { recursive: true });
      }
      await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await writeFile(path.join(pluginRoot, 'manifest.json'), '{"plugin":{"version":"1.2.0"}}');
      await writeFile(path.join(pluginRoot, 'scripts/build-release.mjs'),
        await readFile(new URL(`../plugins/${name}/scripts/build-release.mjs`, import.meta.url)));
      await writeFile(path.join(root, 'scripts/lib/repositoryIdentity.mjs'), String.raw`
import { appendFile } from 'node:fs/promises';
export async function prepareRepositoryIdentity() {
  if (process.env.FAIL_IDENTITY === '1') throw new Error('source unavailable');
  await appendFile(process.env.ORDER_LOG, 'identity\n');
}
`);
      const workerScript = name === 'mind-map'
        ? path.join(pluginRoot, 'scripts/build-release-wasm.sh')
        : path.join(root, 'scripts/build_weather_release_wasm.sh');
      await writeFile(workerScript, '#!/bin/sh\nprintf \'worker\n\' >> "$ORDER_LOG"\n', { mode: 0o755 });
      await writeFile(path.join(root, 'bin/npm'), '#!/bin/sh\nprintf \'ui\n\' >> "$ORDER_LOG"\n', { mode: 0o755 });
      const log = path.join(root, 'order.log');
      const options = { env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, ORDER_LOG: log } };
      const script = path.join(pluginRoot, 'scripts/build-release.mjs');
      await execute(process.execPath, [script], options);
      assert.equal(await readFile(log, 'utf8'), 'identity\nworker\nui\n');
      await rm(log);
      await assert.rejects(execute(process.execPath, [script], {
        env: { ...options.env, FAIL_IDENTITY: '1' },
      }), /source unavailable/);
      await assert.rejects(readFile(log), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
