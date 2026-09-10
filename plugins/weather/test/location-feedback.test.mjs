import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { majorCitiesForLocale } from '../ui/src/weather-model.ts';

const bundle = await build({
  entryPoints: [new URL('../ui/src/app.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  jsxImportSource: '@floegence/redevplugin-ui',
  plugins: [{
    name: 'controlled-weather-bridge',
    setup(builder) {
      builder.onResolve({ filter: /^@floegence\/redevplugin-ui\/plugin$/ }, () => ({ path: 'bridge', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
        export const PluginBridgeClient = globalThis.TestBridge;
        export class PluginBridgeError extends Error {}
      ` }));
    },
  }],
});

const [beijing, tokyo, singapore] = majorCitiesForLocale('en-US');
const forecast = {
  timezone: 'Asia/Shanghai', timezone_abbreviation: 'CST', source: 'saved',
  current: { time: '2026-09-05T12:00', temperature: 22, apparent_temperature: 23, humidity: 70, weather_code: 3, wind_speed: 6, is_day: true },
  days: [],
};

function harness({ initial = true, locale = 'en-US', dataForecast = forecast } = {}) {
  const actions = new Map();
  const calls = [];
  let tree;
  let contextHandler;
  class TestBridge {
    async ready() {}
    onContext(handler) { contextHandler = handler; handler({ locale: { language_tag: locale } }); }
    onLifecycle() {}
    onAction(name, handler) { actions.set(name, handler); }
    async render(next) { tree = next; }
    call(method, input) {
      if (method === 'weather.state.load') return Promise.resolve({ data: {
        favorites: initial ? [beijing, tokyo] : [], selected: initial ? beijing : null, forecast: initial ? dataForecast : null,
      } });
      return new Promise((resolve, reject) => calls.push({ method, input, resolve: (data) => resolve({ data }), reject, tree }));
    }
  }
  vm.runInNewContext(bundle.outputFiles[0].text, {
    TestBridge, setInterval: () => 1, clearInterval() {}, queueMicrotask,
  });
  return {
    calls,
    context(locale) { contextHandler({ locale: { language_tag: locale } }); },
    get tree() { return tree; },
    action(name, event = {}) { actions.get(name)(event); },
  };
}

function find(node, key) {
  if (node?.key === key) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, key);
    if (found) return found;
  }
}

function content(node) {
  return node?.type === 'text' ? node.text : (node?.children ?? []).map(content).join('');
}

async function flush() { await new Promise((resolve) => setImmediate(resolve)); }

async function ready(options) {
  const app = harness(options);
  await flush();
  if (options?.initial !== false) {
    app.calls.shift().resolve({ location: beijing, forecast: options?.dataForecast ?? forecast, favorites: [beijing, tokyo] });
    await flush();
    app.action('toggle-location-chooser');
    await flush();
  }
  return app;
}

for (const [action, key] of [['preview-location', 'major-open-preset:tokyo'], ['open-location', 'favorite-open-preset:tokyo']]) {
  test(`${action} displays pending feedback before a slow forecast and commits only on success`, async () => {
    const app = await ready();
    app.action(action, { value: tokyo.id });
    await flush();
    const pending = app.calls[0];
    assert.equal(pending.method, 'weather.forecast');
    assert.ok(find(pending.tree, 'location-popover'), 'keep the picker stable during the request');
    assert.equal(find(pending.tree, key).attributes['aria-busy'], true);
    assert.match(content(find(pending.tree, 'chooser-status')), /Tokyo/u);
    assert.equal(content(find(pending.tree, 'place-name')), 'Beijing', 'keep old weather bound to its own city');
    app.action('preview-location', { value: singapore.id });
    await flush();
    assert.equal(app.calls.length, 1, 'queue city changes instead of starting parallel requests');
    assert.equal(find(app.tree, 'major-open-preset:singapore').attributes['aria-busy'], true);
    assert.equal(find(app.tree, key).attributes.disabled, false);
    assert.match(content(find(app.tree, 'chooser-status')), /Singapore/u);
    pending.resolve({ location: tokyo, forecast: { ...forecast, timezone: tokyo.timezone }, favorites: [tokyo, beijing] });
    await flush();
    assert.equal(app.calls.length, 2, 'start the queued city after the active request finishes');
    const queued = app.calls[1];
    assert.equal(queued.method, 'weather.forecast');
    assert.equal(queued.input.id, singapore.id);
    assert.equal(content(find(app.tree, 'place-name')), 'Beijing', 'keep the previous weather visible while queued city loads');
    queued.resolve({ location: singapore, forecast: { ...forecast, timezone: singapore.timezone }, favorites: [singapore, tokyo] });
    await flush();
    assert.equal(find(app.tree, 'location-popover'), undefined);
    assert.equal(content(find(app.tree, 'place-name')), 'Singapore');
    assert.equal(find(app.tree, 'refresh').attributes.disabled, false);
  });
}

for (const fails of [false, true]) {
  test(`latest city selection wins when the superseded request ${fails ? 'fails' : 'succeeds'}`, async () => {
    const app = await ready();
    app.action('preview-location', { value: tokyo.id });
    await flush();
    app.action('preview-location', { value: singapore.id });
    app.action('open-location', { value: beijing.id });
    await flush();
    assert.equal(app.calls.length, 1);
    assert.match(content(find(app.tree, 'chooser-status')), /Beijing/u);
    assert.equal(find(app.tree, 'major-open-preset:singapore').attributes['aria-busy'], false);
    assert.equal(find(app.tree, 'favorite-open-preset:beijing').attributes['aria-busy'], true);
    assert.equal(find(app.tree, 'favorite-remove-preset:beijing').attributes.disabled, true);
    assert.equal(find(app.tree, 'refresh').attributes.disabled, true);
    if (fails) app.calls[0].reject(new Error('Network timeout'));
    else app.calls[0].resolve({ location: tokyo, forecast, favorites: [tokyo, beijing] });
    await flush();
    assert.equal(app.calls.length, 2);
    assert.equal(app.calls[1].input.id, beijing.id);
    assert.ok(find(app.tree, 'location-popover'));
    assert.equal(content(find(app.tree, 'place-name')), 'Beijing');
    assert.doesNotMatch(find(app.tree, 'chooser-status').attributes.class, /error/u);
    app.calls[1].resolve({ location: beijing, forecast, favorites: [beijing, tokyo] });
    await flush();
    assert.equal(app.calls.length, 2);
    assert.equal(find(app.tree, 'location-popover'), undefined);
    assert.equal(content(find(app.tree, 'place-name')), 'Beijing');
  });
}

test('failed city changes preserve existing weather, surface the error, and allow retry', async () => {
  const app = await ready();
  app.action('preview-location', { value: tokyo.id });
  await flush();
  app.calls[0].reject(new Error('Network timeout'));
  await flush();
  assert.equal(content(find(app.tree, 'place-name')), 'Beijing');
  assert.ok(find(app.tree, 'location-popover'));
  assert.match(find(app.tree, 'chooser-status').attributes.class, /error/u);
  assert.equal(find(app.tree, 'major-open-preset:tokyo').attributes.disabled, false);
  assert.equal(find(app.tree, 'major-open-preset:tokyo').attributes['aria-busy'], false);
  app.action('preview-location', { value: tokyo.id });
  await flush();
  assert.equal(app.calls.length, 2);
});

test('first-visit city selection has localized pending feedback', async () => {
  const app = await ready({ initial: false, locale: 'zh-CN' });
  app.action('preview-location', { value: tokyo.id });
  await flush();
  assert.ok(find(app.calls[0].tree, 'location-onboarding'));
  assert.match(content(find(app.calls[0].tree, 'chooser-status')), /东京/u);
  assert.equal(find(app.calls[0].tree, 'major-open-preset:tokyo').attributes['aria-busy'], true);
});

test('search result selection shows pending feedback without removing the result', async () => {
  const app = await ready();
  app.action('search-location', { form_data: { query: 'Tokyo' } });
  await flush();
  app.calls.shift().resolve({ locations: [tokyo] });
  await flush();
  app.action('preview-location', { value: tokyo.id });
  await flush();
  assert.equal(find(app.calls[0].tree, 'result-open-preset:tokyo').attributes['aria-busy'], true);
  assert.equal(find(app.tree, 'result-open-preset:tokyo').attributes.disabled, false);
  assert.match(content(find(app.calls[0].tree, 'chooser-status')), /Tokyo/u);
});

test('closing the chooser during loading leaves visible feedback and a visible error on failure', async () => {
  const app = await ready();
  app.action('preview-location', { value: tokyo.id });
  await flush();
  app.action('toggle-location-chooser');
  await flush();
  assert.match(content(find(app.tree, 'weather-progress')), /Tokyo/u);
  app.calls[0].reject(new Error('Network timeout'));
  await flush();
  assert.equal(find(app.tree, 'weather-progress'), undefined);
  assert.ok(find(app.tree, 'weather-alert'));
  assert.equal(content(find(app.tree, 'place-name')), 'Beijing');
});


test('detail actions are bounded to forecast data and Escape closes the detail', async () => {
  const app = await ready();
  app.action('open-detail', { value: 'humidity' });
  await flush();
  assert.ok(find(app.tree, 'weather-detail'));
  assert.match(content(find(app.tree, 'weather-detail')), /70%/u);
  app.action('close-detail');
  await flush();
  assert.equal(find(app.tree, 'detail-layer').attributes.hidden, true);
  app.action('open-day', { value: '999' });
  await flush();
  assert.equal(find(app.tree, 'detail-layer').attributes.hidden, true);
});

const detailedForecast = {
  ...forecast,
  days: [
    { date: '2026-09-05', weather_code: 3, temperature_max: 25, temperature_min: 21, precipitation_probability: 0, sunrise: '2026-09-05T06:11', sunset: '2026-09-05T18:39' },
    { date: '2026-09-06', weather_code: 2, temperature_max: 28, temperature_min: 20, precipitation_probability: 30, sunrise: '2026-09-06T06:12', sunset: '2026-09-06T18:38' },
  ],
  hourly: [
    { ...forecast.current, time:'2026-09-05T12:00', precipitation_probability:0, wind_direction:345, wind_gusts:24, pressure:1021, visibility:17000, uv_index:3 },
    { ...forecast.current, time:'2026-09-06T12:00', humidity:60, precipitation_probability:30, wind_direction:345, wind_gusts:24, pressure:1021, visibility:null, uv_index:null },
  ],
};

test('day selection and actual/apparent tabs project only the chosen day', async () => {
  const app = await ready({ dataForecast: detailedForecast });
  app.action('open-day', { value: '1' }); await flush();
  assert.equal(content(find(app.tree, 'detail-date')), 'September 6, 2026');
  assert.equal(find(app.tree, 'actual-tab').attributes['aria-pressed'], true);
  app.action('detail-temperature', { value: 'apparent' }); await flush();
  assert.equal(find(app.tree, 'apparent-tab').attributes['aria-pressed'], true);
  app.action('detail-day', { value: '-1' }); await flush();
  assert.equal(content(find(app.tree, 'detail-date')), 'September 6, 2026');
});

test('future humidity details use percentage units and optional missing metrics stay unavailable', async () => {
  const app = await ready({ dataForecast: detailedForecast });
  app.action('open-detail', { value: 'humidity' }); await flush();
  app.action('detail-day', { value: '1' }); await flush();
  assert.match(content(find(app.tree, 'detail-value')), /60–60%/u);
  assert.doesNotMatch(content(find(app.tree, 'detail-value')), /°/u);
  app.action('close-detail'); await flush();
  app.action('open-detail', { value: 'visibility' }); await flush();
  app.action('detail-day', { value: '1' }); await flush();
  assert.ok(find(app.tree, 'detail-no-hours'));
});

test('language changes relabel saved presets and existing notices without changing city identity', async () => {
  const app = await ready();
  app.action('search-location', { form_data: { query: '' } }); await flush();
  app.context('zh-TW'); await flush();
  assert.equal(content(find(app.tree, 'place-name')), '北京');
  assert.match(content(find(app.tree, 'chooser-status')), /搜尋/);
  app.context('ja-JP'); await flush();
  assert.match(content(find(app.tree, 'chooser-status')), /検索/);
  assert.equal(content(find(app.tree, 'major-name-preset:tokyo')), '東京');
});

test('search forwards the supported provider language from surface context', async () => {
  const app = await ready({ initial: false, locale: 'de-DE' });
  app.action('search-location', { form_data: { query: 'Berlin' } }); await flush();
  assert.equal(app.calls[0].input.language, 'de');
});

for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU']) {
  test(`${locale} renders the complete dashboard and details through the SDK`, async () => {
    const app = await ready({ locale, dataForecast: detailedForecast });
    assert.equal(find(app.tree, 'weather-root').attributes.lang, locale);
    app.action('open-day', { value: '0' }); await flush();
    const text = content(app.tree);
    assert.doesNotMatch(text, /undefined|\{(?:city|count|chance|speed|temperature)\}/u);
    assert.ok(content(find(app.tree, 'detail-title')));
    assert.ok(content(find(app.tree, 'detail-date')));
    app.action('close-detail'); await flush();
  });
}

test('every metric opens and closes repeatedly without duplicate SDK node keys', async () => {
  const app = await ready({ dataForecast: detailedForecast });
  for (const metric of ['wind', 'sunset', 'rain', 'feels-like', 'humidity', 'uv', 'visibility', 'pressure', 'sunset']) {
    app.action('open-detail', { value: metric }); await flush();
    assert.ok(find(app.tree, 'weather-detail'));
    app.action('close-detail'); await flush();
    assert.equal(find(app.tree, 'detail-layer').attributes.hidden, true);
  }
});
