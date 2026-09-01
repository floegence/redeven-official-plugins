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
      'open-location',
      'remove-location',
      'refresh-weather',
      'toggle-location-chooser',
    ]) {
      assert.match(ui, new RegExp(action, 'u'));
    }
    assert.match(ui, /bridge\.onContext/u);
    assert.match(model, /Open-Meteo/u);
    assert.doesNotMatch(ui, /save-location|save-selected|\bt\.saved\b|\bt\.save\b/u);
    assert.doesNotMatch(ui, /state\.status|errorScope/u);
    assert.doesNotMatch(model, /\b(?:appName|currentLocation|ready|updated|savedForecast):/u);
  });

  it('renders cached weather first, refreshes in the background, and fits the surface viewport', async () => {
    const [ui, worker, manifest, styles] = await Promise.all([
      readFile(path.join(pluginRoot, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(pluginRoot, 'worker', 'src', 'lib.rs'), 'utf8'),
      readFile(path.join(pluginRoot, 'manifest.json'), 'utf8').then(JSON.parse),
      readFile(path.join(pluginRoot, 'ui', 'styles.css'), 'utf8'),
    ]);
    const stateLoad = manifest.methods.find((method) => method.method === 'weather.state.load');
    assert.ok(stateLoad);
    assert.ok(stateLoad.response_schema.required.includes('forecast'));
    assert.deepEqual(stateLoad.response_schema.properties.forecast.anyOf.at(-1), { type: 'null' });
    assert.match(worker, /cached_forecast_for_selected/u);
    assert.match(ui, /response\.data\.forecast/u);
    assert.match(ui, /void loadForecast\(response\.data\.selected/u);
    assert.match(styles, /height:\s*100svh/u);
    assert.match(styles, /overflow:\s*hidden/u);
    assert.match(styles, /@media\s*\(max-height:\s*600px\)/u);
    assert.doesNotMatch(ui, /location-chooser-empty/u);
    assert.match(ui, /state\.chooserOpen\s*\?\s*locationChooser\(t\)\s*:\s*null/u);
    assert.match(styles, /\.weather-app\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto/su);
    assert.match(styles, /\.clock-column\s*\{[^}]*grid-template-rows:\s*repeat\(3, max-content\)[^}]*align-content:\s*center[^}]*row-gap:\s*clamp\(8px,/su);
    assert.match(styles, /\.place-copy\s*\{[^}]*display:\s*grid[^}]*gap:\s*clamp\(5px,/su);
    assert.match(styles, /\.local-time\s*\{[^}]*line-height:\s*1\.08;/su);
    assert.match(styles, /\.temperature-copy\s*\{[^}]*gap:\s*clamp\(6px,/su);
    assert.match(styles, /\.forecast-row\s*\{[^}]*line-height:\s*1\.35;/su);
    assert.match(styles, /\.search-result-button\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/su);
    assert.doesNotMatch(styles, /align-content:\s*space-between/u);
    const currentSummary = styles.match(/\.current-column\s*\{(?<rules>[^}]*)\}/u)?.groups?.rules;
    assert.ok(currentSummary);
    assert.doesNotMatch(currentSummary, /\bborder(?:-radius)?\s*:/u);
    assert.doesNotMatch(currentSummary, /\bbackground\s*:/u);
    assert.doesNotMatch(currentSummary, /\bbox-shadow\s*:/u);
    assert.doesNotMatch(styles, /@media\s*\(max-width:\s*460px\)[\s\S]*?\.current-column\s*\{/u);
    assert.doesNotMatch(ui, /className="topbar"|className="brand"|className="status-row/u);
    assert.doesNotMatch(ui, /state\.status\s*=\s*preserveVisible\s*\?\s*translations\(\)\.refreshing/u);
    assert.match(ui, /className="weather-card-controls"/u);
    assert.match(ui, /className="location-trigger-name"/u);
    assert.match(ui, /className="refresh-icon"/u);
    assert.match(ui, /const refreshing = state\.busy === "forecast" && Boolean\(state\.forecast\)/u);
    assert.match(ui, /refreshing\s*\?\s*"icon-button weather-card-refresh is-refreshing"/u);
    assert.match(styles, /\.weather-card-refresh\.is-refreshing \.refresh-icon\s*\{[^}]*animation:\s*spin 800ms linear infinite/su);
    assert.doesNotMatch(styles, /\.topbar\b|\.topbar-actions\b|\.status-row\b/u);
    const dashboard = ui.match(/function forecastDashboard[\s\S]*?function forecastRow/u)?.[0];
    assert.ok(dashboard);
    assert.match(dashboard, /className="weather-hero"[\s\S]*weatherCardControls\(t\)[\s\S]*className="current-column"/u);
  });

  it('uses brokered network and KV storage from the WASM worker', async () => {
    const worker = await readFile(path.join(pluginRoot, 'worker', 'src', 'lib.rs'), 'utf8');
    for (const method of [
      'weather.state.load',
      'weather.locations.search',
      'weather.locations.remove',
      'weather.forecast',
    ]) {
      assert.match(worker, new RegExp(method.replaceAll('.', '\\.'), 'u'));
    }
    assert.match(worker, /geocoding-api\.open-meteo\.com/u);
    assert.match(worker, /api\.open-meteo\.com/u);
    assert.match(worker, /storage::kv/u);
    assert.match(worker, /MAX_RESPONSE_BYTES/u);
    assert.match(worker, /remember_location/u);
    assert.doesNotMatch(worker, /weather\.locations\.save|fn save_location/u);
    const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'));
    assert.equal(manifest.methods.some((method) => method.method === 'weather.locations.save'), false);
    const forecast = manifest.methods.find((method) => method.method === 'weather.forecast');
    assert.ok(forecast.response_schema.required.includes('favorites'));
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
