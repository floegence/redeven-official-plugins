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
    assert.match(styles, /overflow-y:\s*auto/u);
    assert.match(styles, /prefers-reduced-motion/u);
    assert.match(ui, /weatherCardControls\(t\)/u);
    assert.match(ui, /data-redevplugin-escape-action/u);
    assert.doesNotMatch(ui, /className="local-time"/u);
  });

  it('keeps the first visit actionable with one visible location-selection path', async () => {
    const [ui, model, styles] = await Promise.all([
      readFile(path.join(pluginRoot, 'ui', 'src', 'app.tsx'), 'utf8'),
      readFile(path.join(pluginRoot, 'ui', 'src', 'weather-model.ts'), 'utf8'),
      readFile(path.join(pluginRoot, 'ui', 'styles.css'), 'utf8'),
    ]);
    assert.match(ui, /function locationPicker\(\s*t: WeatherTranslations,\s*mode: "onboarding" \| "popover",?\s*\)/u);
    assert.match(ui, /state\.busy === "initial"[\s\S]*loadingState\(t\)[\s\S]*locationPicker\(t, "onboarding"\)/u);
    assert.match(ui, /mode === "onboarding"\s*\? onboardingIntroduction\(t\)\s*: pickerHeading\(t\)/u);
    assert.match(ui, /state\.busy === "forecast"\s*\?\s*t\.loading/u);
    assert.doesNotMatch(ui, /function emptyState|empty-symbol/u);
    assert.doesNotMatch(model, /emptyTitle|emptyBody/u);
    assert.match(model, /onboardingTitle: "Choose a city to begin"/u);
    assert.match(model, /onboardingTitle: "先选择一个城市"/u);
    assert.match(styles, /\.location-onboarding\s*\{/u);
    assert.match(styles, /\.location-popover\s*\{/u);
    assert.doesNotMatch(styles, /\.empty-state|\.empty-symbol/u);
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

  it('keeps continuous weather layers free of viewport-sized blur passes', async () => {
    const styles = await readFile(path.join(pluginRoot, 'ui', 'styles.css'), 'utf8');
    for (const selector of ['.cloud', '.glass-card', '.city-sidebar', '.weather-sky::after']) {
      const blocks = [...styles.matchAll(new RegExp(selector.replaceAll('.', '\\.') + '\\s*\\{([^}]+)\\}', 'gu'))];
      assert.ok(blocks.length, selector);
      for (const block of blocks) assert.doesNotMatch(block[1], /(?:backdrop-)?filter:\s*blur/u);
    }
    for (const block of styles.matchAll(/\.cloud(?:-two)?\s*\{([^}]+)\}/gu)) {
      assert.doesNotMatch(block[1], /(?:width|height):\s*[\d.]+%/u, 'cloud rasters keep a stable size between breakpoints');
    }
    assert.doesNotMatch(styles, /inset:\s*-100%/u);
    assert.doesNotMatch(styles, /@keyframes toolbar-glass[^}]*backdrop-filter/u);
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
    assert.match(readme, /original/u);
    assert.match(readme, /Open-Meteo/u);
  });
});
