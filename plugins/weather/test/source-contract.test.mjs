import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Weather official plugin source contract', () => {
  it('keeps browser persistence and direct networking outside the opaque surface', async () => {
    const [ui, model] = await Promise.all([
      readFile(path.join(pluginRoot, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(pluginRoot, 'ui', 'src', 'weather-model.ts'), 'utf8'),
    ]);
    assert.doesNotMatch(ui, /\bfetch\s*\(|localStorage|sessionStorage|indexedDB|WebSocket/u);
    for (const action of [
      'search-location',
      'preview-location',
      'save-location',
      'open-location',
      'remove-location',
      'refresh-weather',
    ]) {
      assert.match(ui, new RegExp(action, 'u'));
    }
    assert.match(ui, /bridge\.onContext/u);
    assert.match(model, /Open-Meteo/u);
  });

  it('uses brokered network and KV storage from the WASM worker', async () => {
    const worker = await readFile(path.join(pluginRoot, 'worker', 'src', 'lib.rs'), 'utf8');
    for (const method of [
      'weather.state.load',
      'weather.locations.search',
      'weather.locations.save',
      'weather.locations.remove',
      'weather.forecast',
    ]) {
      assert.match(worker, new RegExp(method.replaceAll('.', '\\.'), 'u'));
    }
    assert.match(worker, /geocoding-api\.open-meteo\.com/u);
    assert.match(worker, /api\.open-meteo\.com/u);
    assert.match(worker, /storage::kv/u);
    assert.match(worker, /MAX_RESPONSE_BYTES/u);
  });

  it('ships an original package-local icon and upstream attribution', async () => {
    const [manifest, release, readme] = await Promise.all([
      readFile(path.join(pluginRoot, 'manifest.json'), 'utf8').then(JSON.parse),
      readFile(path.join(pluginRoot, 'release.json'), 'utf8').then(JSON.parse),
      readFile(path.join(pluginRoot, 'README.md'), 'utf8'),
    ]);
    assert.equal(manifest.presentation.icon.path, 'ui/assets/weather-plugin.png');
    assert.equal(manifest.surfaces[0].icon, 'ui/assets/weather-plugin.png');
    assert.equal(release.package_assets['ui/assets/weather-plugin.png'], 'assets/weather-plugin.png');
    assert.match(readme, /clock-weather-card/u);
    assert.match(readme, /MIT/u);
    assert.match(readme, /Open-Meteo/u);
  });
});
