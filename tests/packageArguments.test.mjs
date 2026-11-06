import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/build_official_plugin.mjs', import.meta.url));

for (const args of [[], ['missing-plugin', '--unknown'], ['missing-plugin', '--release', 'extra']]) {
  test(`packager rejects unsupported arguments: ${JSON.stringify(args)}`, async () => {
    await assert.rejects(execute(process.execPath, [script, ...args]), error => error.message.includes('usage: node scripts/build_official_plugin.mjs'));
  });
}
