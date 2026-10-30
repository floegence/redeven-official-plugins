import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Weather uses public Floe controls and keeps weather state in its existing worker', async () => {
  const [ui, worker] = await Promise.all([read('ui/src/app.tsx'),read('worker/src/lib.rs')]);
  assert.match(ui,/@floegence\/floe-webapp-core\/ui/);
  assert.match(ui,/@floegence\/floe-webapp-core\/styles/);
  assert.doesNotMatch(ui,/@floegence\/floe-webapp-core\/src\//);
  assert.doesNotMatch(ui,/bridge\.(?:render|onAction|openCanvas|onCanvasInput)|PluginUIActionEvent|data-redevplugin-action/);
  for(const method of ['weather.state.load','weather.locations.search','weather.locations.remove','weather.forecast']) assert.ok(worker.includes(method));
  assert.match(worker,/cached_forecast_for_selected/);
  assert.match(worker,/storage::kv/);
  assert.match(worker,/MAX_RESPONSE_BYTES/);
});

test('weather broker contracts retain exact providers and persistent data scope',async()=>{
  const manifest=JSON.parse(await read('manifest.json'));
  assert.deepEqual(manifest.storage.stores,[{store_id:'weather',kind:'kv',scope:'user',quota_bytes:1048576,quota_files:16,schema_version:1}]);
  assert.deepEqual(manifest.network_access.connectors.map(c=>c.destinations),[['https://geocoding-api.open-meteo.com'],['https://api.open-meteo.com']]);
  assert.ok(manifest.methods.find(m=>m.method==='weather.state.load').response_schema.required.includes('forecast'));
  assert.ok(manifest.methods.find(m=>m.method==='weather.forecast').response_schema.required.includes('favorites'));
});

test('the package retains original icon evidence and provider attribution',async()=>{
  const manifest=JSON.parse(await read('manifest.json'));
  const release=JSON.parse(await read('release.json'));
  assert.equal(manifest.presentation.icon.path,'ui/assets/weather-plugin.png');
  assert.equal(release.package_assets[manifest.presentation.icon.path],'assets/weather-plugin.png');
  assert.match(await read('README.md'),/Open-Meteo/);
});
