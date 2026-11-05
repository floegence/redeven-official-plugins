import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
const execute = promisify(execFile);
test('reconciles an existing release by verifying downloaded bytes without rebuilding or uploading', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'official-release-recovery-'));
  try {
    await mkdir(path.join(root, 'bin')); await mkdir(path.join(root, 'scripts')); await mkdir(path.join(root, 'plugins/weather'), { recursive: true });
    await writeFile(path.join(root, 'scripts/publish.sh'), await readFile(new URL('../scripts/publish_official_plugin_release.sh', import.meta.url)));
    const calls = path.join(root, 'calls');
    const commands = {
      node: '#!/bin/sh\ncase "$1" in *resolve_release*) echo weather;; *) echo verify >> "$CALLS";; esac\n',
      jq: '#!/bin/sh\ncase "$1" in *version*) echo 1.1.0;; *) echo Weather;; esac\n',
      npm: '#!/bin/sh\necho build >> "$CALLS"; exit 99\n',
      gh: '#!/bin/sh\necho "$*" >> "$CALLS"\nif [ "$2" = view ]; then if [ "$#" -gt 3 ]; then echo false; fi; exit 0; fi\nif [ "$2" = download ]; then touch "$5/weather-1.1.0.redevplugin" "$5/weather-1.1.0.metadata.json"; exit 0; fi\nexit 99\n',
    };
    for (const [name, text] of Object.entries(commands)) await writeFile(path.join(root, 'bin', name), text, { mode: 0o755 });
    await execute('bash', ['scripts/publish.sh', 'weather-v1.1.0'], { cwd: root, env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, CALLS: calls } });
    const log = await readFile(calls, 'utf8');
    assert.match(log, /release download/u); assert.match(log, /verify/u);
    assert.doesNotMatch(log, /build|release create|release upload/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
