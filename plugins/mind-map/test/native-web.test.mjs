import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
it('owns ordinary DOM and Canvas events without the retired VNode protocol', async () => {
  const app = await read('ui/src/app.tsx');
  for (const retired of ['bridge.render(', 'bridge.onAction(', 'bridge.openCanvas(', 'bridge.onCanvasInput(', 'data-redevplugin-action', 'PluginUIActionEvent']) assert.ok(!app.includes(retired), retired);
  for (const native of ['ResizeObserver', 'onPointerDown', 'onKeyDown', 'onCompositionStart', 'FloeProvider', 'Dialog', 'registerMethod', 'beforeClose']) assert.ok(app.includes(native), native);
  const entry = await read('ui/index.html');
  assert.ok(entry.includes('type="module"'));
  assert.ok(!entry.includes('text/redevplugin-worker'));
});
it('keeps the current DSL and contiguous durable data migrations', async () => {
  const worker = await read('worker/src/lib.rs');
  for (const marker of ['workspace-v1.json', 'workspace-v2.json', 'workspace-v3.json', 'migrate_v1_to_v2', 'migrate_v2_to_v3']) assert.ok(worker.includes(marker));
  const manifest = JSON.parse(await read('manifest.json'));
  assert.deepEqual(manifest.permissions, []);
  assert.equal(manifest.storage.stores[0].schema_version, 1);
  assert.ok(manifest.methods.some(method => method.method === 'mindmap.document.edit' && method.route.kind === 'surface'));
});
it('builds ordinary modules without generated editor-position CSS or PNG UI icons', async () => {
  const build = await read('scripts/build.mjs');
  assert.ok(!build.includes('nodeEditorPlacementCSS'));
  assert.ok(!build.includes('assets/icons'));
  const ts = JSON.parse(await read('tsconfig.json'));
  assert.equal(ts.compilerOptions.jsxImportSource, 'solid-js');
  const wasm = await read('scripts/build-release-wasm.sh');
  assert.ok(wasm.includes('rust:1.88-bookworm@sha256:'));
});
