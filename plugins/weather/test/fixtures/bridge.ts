import { majorCitiesForLocale } from '../../ui/src/weather-model';
import { fullForecast } from './full-forecast';
import { createPluginTestContext, createPluginTestHarness } from '@floegence/redevplugin-ui/testing';
export { PluginBridgeError } from '@floegence/redevplugin-ui';
const query = new URLSearchParams(location.search);
const cities = majorCitiesForLocale('en-US');
const initial = new URLSearchParams(location.search).get('initial') !== 'false';
const locale = new URLSearchParams(location.search).get('locale') ?? 'en-US';
const current = { time: '2026-09-05T12:00', temperature: 22, apparent_temperature: 23, humidity: 70, weather_code: 3, wind_speed: 6, is_day: true };
const sparseForecast = {
  timezone: 'Asia/Shanghai', timezone_abbreviation: 'CST', source: 'network', current,
  days: [
    { date: '2026-09-05', weather_code: 3, temperature_max: 25, temperature_min: 21, precipitation_probability: 0, sunrise: '2026-09-05T06:11', sunset: '2026-09-05T18:39' },
    { date: '2026-09-06', weather_code: 2, temperature_max: 28, temperature_min: 20, precipitation_probability: 30, sunrise: '2026-09-06T06:12', sunset: '2026-09-06T18:38' },
  ],
  hourly: [
    { ...current, time:'2026-09-05T12:00', precipitation_probability:0, wind_direction:345, wind_gusts:24, pressure:1021, visibility:17000, uv_index:3 },
    { ...current, time:'2026-09-06T12:00', humidity:60, precipitation_probability:30, wind_direction:345, wind_gusts:24, pressure:1021, visibility:null, uv_index:null },
  ],
};
const forecast = query.get('fixture') === 'full' ? fullForecast(query.get('sky') ?? 'cloudy') : sparseForecast;
const pending: any[] = [];
let contextRevision = 0;
function context(language = locale, color_scheme = 'light') {
  const value = createPluginTestContext(language, ++contextRevision);
  value.appearance.color_scheme = color_scheme as 'light' | 'dark';
  return value;
}
const harness = createPluginTestHarness({
  context: context(),
  call(method, input) {
    if (method === 'weather.state.load') return Promise.resolve(structuredClone({ data: {
      location_summaries: cities.slice(0,2).map((city, index) => ({ location_id:city.id, current: { ...forecast.current, weather_code: index ? 61 : forecast.current.weather_code }, today:forecast.days[0] })),
      favorites: initial ? cities.slice(0,2) : [], selected: initial ? cities[0] : null,
      forecast: initial ? forecast : null,
    } }));
    return new Promise((resolve, reject) => {
      pending.push({ method, input, resolve: (value: unknown) => resolve(structuredClone(value)), reject });
      if (query.get('auto') === '1') setTimeout(() => (window as any).__weatherTest.settle(), 160);
    });
  }
});
export const PluginBridgeClient = harness.BridgeClient;
Object.assign(window, { __weatherTest: {
  pending: () => pending.map(({ method, input }) => ({ method, input })),
  context: (language: string, theme = 'light') => harness.context(context(language, theme)),
  settle: (options: { fail?: boolean; source?: string; hourly?: boolean; empty?: boolean } = {}) => {
    const call = pending.shift();
    if (!call) throw new Error('No pending Weather request');
    if (options.fail) { call.reject(new Error('Network timeout')); return; }
    if (call.method === 'weather.locations.search') { call.resolve({ data: { locations: options.empty ? [] : [cities[1]] } }); return; }
    if (call.method === 'weather.locations.remove') { call.resolve({ data: { favorites: cities.slice(0,2).filter((city) => city.id !== call.input.id) } }); return; }
    const location = cities.find((city) => city.id === call.input.id) ?? call.input;
    call.resolve({ data: { location, forecast: { ...forecast, timezone: location.timezone, source: options.source ?? 'network', hourly: options.hourly === false ? [] : forecast.hourly }, favorites: cities.slice(0,3) } });
  },
} });
