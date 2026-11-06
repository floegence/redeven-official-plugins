import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRepositoryIdentity } from '../scripts/lib/repositoryIdentity.mjs';

test('build preparation resolves source identity before replacing the index', async () => {
  const calls = [];
  await prepareRepositoryIdentity('/repo/plugins/weather', 'weather', async (args) => {
    calls.push(args);
    return { publisher_id: 'github.repo.42', plugin_id: 'github.repo.42.weather' };
  });
  assert.deepEqual(calls, [
    ['repository', 'identity', '/repo/plugins/weather', 'weather'],
    ['scaffold', 'repository-index', '/repo', 'redeven', '--project', 'plugins/weather', '--manifest', 'manifest.json', '--tag-template', 'weather-v{version}', '--package-asset-template', 'weather-{version}.redevplugin', '--replace'],
  ]);
});

test('a failed source resolution never rewrites the index', async () => {
  let calls = 0;
  await assert.rejects(prepareRepositoryIdentity('/repo/plugins/weather', 'weather', async () => {
    calls++; throw new Error('source unavailable');
  }), /source unavailable/);
  assert.equal(calls, 1);
});
