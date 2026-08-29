import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionForCode,
  localeForLanguageTag,
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

  it('uses Simplified Chinese for Chinese surface contexts and English otherwise', () => {
    assert.equal(localeForLanguageTag('zh-CN'), 'zh-CN');
    assert.equal(localeForLanguageTag('zh-Hant-TW'), 'zh-CN');
    assert.equal(localeForLanguageTag('de-DE'), 'en-US');
    assert.equal(translationsForLocale('zh-CN').searchPlaceholder, '搜索城市或地区');
    assert.equal(translationsForLocale('en-US').searchPlaceholder, 'Search city or place');
  });
});
