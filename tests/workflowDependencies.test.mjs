import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const [workflow, entrypoint] of [
  ['ci.yml', 'npm run catalog:verify'],
  ['release.yml', 'node scripts/resolve_release_plugin.mjs'],
  ['recover-release.yml', 'node scripts/resolve_release_plugin.mjs'],
]) {
  test(`${workflow} installs released contracts before loading plugin metadata`, async () => {
    const source = await readFile(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');
    const install = source.indexOf('- run: npm ci');
    assert.ok(install >= 0 && install < source.indexOf(entrypoint));
  });
}
