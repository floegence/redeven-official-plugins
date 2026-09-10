import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionForCode,
  localeForLanguageTag,
  majorCitiesForLocale,
  temperatureRangeClasses,
  translationsForLocale,
} from '../ui/src/weather-model.ts';

describe('weather presentation model', () => {
  it('maps Open-Meteo codes into stable accessible conditions', () => {
    assert.deepEqual(conditionForCode(0, true), { kind: 'clear-day', symbol: '☀️', label: 'Clear sky' });
    assert.deepEqual(conditionForCode(0, false), { kind: 'clear-night', symbol: '🌙', label: 'Clear sky' });
    assert.equal(conditionForCode(65, true).kind, 'rain');
    assert.equal(conditionForCode(86, true).kind, 'snow');
    assert.equal(conditionForCode(95, true).kind, 'storm');
    assert.equal(conditionForCode(999, true).kind, 'unknown');
  });

  it('projects daily temperature ranges into bounded visual steps', () => {
    const days = [
      { temperature_min: 9, temperature_max: 21 },
      { temperature_min: 12, temperature_max: 18 },
      { temperature_min: 14, temperature_max: 17 },
    ];
    assert.deepEqual(temperatureRangeClasses(days, days[0], 16), {
      startClass: 'range-start-0',
      widthClass: 'range-width-10',
      currentClass: 'current-position-6',
    });
    assert.deepEqual(temperatureRangeClasses(days, days[2]), {
      startClass: 'range-start-4',
      widthClass: 'range-width-3',
      currentClass: undefined,
    });
  });

  it('resolves supported language families and Chinese scripts', () => {
    assert.equal(localeForLanguageTag('zh-CN'), 'zh-CN');
    assert.equal(localeForLanguageTag('zh-Hant-TW'), 'zh-TW');
    assert.equal(localeForLanguageTag('de-DE'), 'de-DE');
    assert.equal(translationsForLocale('zh-CN').searchPlaceholder, '搜索城市或地区');
    assert.equal(translationsForLocale('en-US').searchPlaceholder, 'Search city or place');
  });

  it('offers stable localized major cities with contract-safe location fields', () => {
    const english = majorCitiesForLocale('en-US');
    const chinese = majorCitiesForLocale('zh-CN');
    assert.equal(english.length, 12);
    assert.deepEqual(english.map((city) => city.id), [
      'preset:beijing',
      'preset:tokyo',
      'preset:singapore',
      'preset:dubai',
      'preset:sydney',
      'preset:london',
      'preset:paris',
      'preset:cairo',
      'preset:cape-town',
      'preset:new-york',
      'preset:los-angeles',
      'preset:sao-paulo',
    ]);
    assert.deepEqual(chinese.map((city) => city.id), english.map((city) => city.id));
    assert.equal(new Set(english.map((city) => city.id)).size, english.length);
    assert.equal(english.find((city) => city.id === 'preset:beijing')?.name, 'Beijing');
    assert.equal(chinese.find((city) => city.id === 'preset:beijing')?.name, '北京');
    assert.equal(chinese.find((city) => city.id === 'preset:new-york')?.name, '纽约');
    for (const city of english) {
      assert.deepEqual(Object.keys(city).sort(), [
        'admin1',
        'country',
        'id',
        'latitude',
        'longitude',
        'name',
        'timezone',
      ]);
      assert.match(city.id, /^preset:[a-z-]+$/u);
      assert.ok(Number.isFinite(city.latitude) && city.latitude >= -90 && city.latitude <= 90);
      assert.ok(Number.isFinite(city.longitude) && city.longitude >= -180 && city.longitude <= 180);
      assert.match(city.timezone, /^[A-Za-z_+-]+\/[A-Za-z_+-]+$/u);
    }
  });
});

it('plots forecast-local clock hours without compressing missing observations', async () => {
  const { chartPoints } = await import('../ui/src/weather-chart.ts');
  assert.deepEqual(chartPoints([
    { time: '2026-09-10T00:00', value: 10 },
    { time: '2026-09-10T12:00', value: 20 },
    { time: '2026-09-10T23:00', value: 15 },
  ], 230, 100, 10, 20), [{ x: 0, y: 100 }, { x: 120, y: 0 }, { x: 230, y: 50 }]);
});

const supportedLocales = ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'];
it('provides complete translated messages and matching placeholders for every locale', () => {
  const flat = (value, prefix = '') => Object.entries(value).flatMap(([key, text]) => typeof text === 'string' ? [[prefix + key, text]] : flat(text, prefix + key + '.'));
  const english = flat(translationsForLocale('en-US'));
  for (const locale of supportedLocales) {
    const translated = flat(translationsForLocale(locale));
    assert.deepEqual(translated.map(([key]) => key).sort(), english.map(([key]) => key).sort(), locale);
    for (const [key, text] of translated) {
      assert.ok(text.trim(), `${locale}: ${key}`);
      assert.deepEqual([...text.matchAll(/\{[^}]+\}/g)].map(String).sort(), [...english.find(([k]) => k === key)[1].matchAll(/\{[^}]+\}/g)].map(String).sort(), `${locale}: ${key}`);
    }
    assert.equal(localeForLanguageTag(locale), locale);
  }
  assert.equal(localeForLanguageTag('zh-HK'), 'zh-TW');
  assert.equal(localeForLanguageTag('zh-Hans-TW'), 'zh-CN');
  assert.equal(localeForLanguageTag('pt-PT'), 'pt-BR');
  assert.equal(localeForLanguageTag('ja'), 'ja-JP');
  assert.equal(localeForLanguageTag('nonsense'), 'en-US');
});

it('formats forecast civil dates without applying the browser time zone', async () => {
  const { formatCivilDate, localizedLocation } = await import('../ui/src/weather-model.ts');
  assert.equal(formatCivilDate('2026-09-06', 'en-US'), 'September 6, 2026');
  assert.equal(formatCivilDate('2026-09-06', 'zh-TW'), '2026年9月6日');
  assert.equal(formatCivilDate('bad', 'en-US'), '—');
  const saved = majorCitiesForLocale('en-US')[1];
  assert.equal(localizedLocation(saved, 'ja-JP').name, '東京');
  assert.equal(localizedLocation(saved, 'ja-JP').id, saved.id);
});
