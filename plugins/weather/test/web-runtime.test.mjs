import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
test('Weather ships a normal Web entry and owns browser interaction', async () => {
  const html = await readFile(new URL('ui/index.html', root), 'utf8');
  const source = await readFile(new URL('ui/src/app.tsx', root), 'utf8');
  assert.match(html, /type="module"/);
  assert.doesNotMatch(html, /text\/redevplugin-worker/);
  assert.doesNotMatch(source, /PluginUIActionEvent|PluginCanvasSurface|bridge\.(?:render|onAction|openCanvas|onCanvasInput)|data-redevplugin-(?:action|canvas|escape-action)/);
});
test('Weather explicitly declares the current Web surface contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.deepEqual(manifest.surfaces[0].web, { root: 'ui', spa: false });
});
