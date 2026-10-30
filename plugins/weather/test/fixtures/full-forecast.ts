// Synthetic visual-review data. These values are never shipped to production.
const start = Date.UTC(2026, 8, 5);
export function fullForecast(scenario = 'cloudy') {
  const sky = ({ sunny: [0, true], night: [0, false], cloudy: [3, true], rain: [63, true], snow: [73, true], fog: [45, true], storm: [95, true] } as Record<string, [number, boolean]>)[scenario] ?? [3, true];
  const date = (index: number) => new Date(start + index * 86_400_000).toISOString().slice(0, 10);
  const days = Array.from({ length: 10 }, (_, index) => ({
    date: date(index), weather_code: [sky[0], 2, 61, 63, 3, 0, 1, 2, 80, 3][index],
    temperature_max: [25, 28, 24, 22, 24, 27, 29, 28, 23, 25][index],
    temperature_min: [18, 20, 18, 17, 18, 19, 21, 20, 18, 17][index],
    precipitation_probability: [10, 20, 65, 80, 15, 0, 5, 10, 70, 20][index],
    precipitation_sum: [0.2, 0, 3.8, 9.2, 0, 0, 0, 0, 5.6, 0.4][index],
    sunrise: date(index) + 'T06:11', sunset: date(index) + 'T18:39',
  }));
  const hourly = days.flatMap((day, index) => Array.from({ length: 24 }, (_, hour) => {
    const temperature = Math.round(day.temperature_min + (day.temperature_max - day.temperature_min) * (1 + Math.cos((hour - 14) * Math.PI / 12)) / 2);
    return { time: day.date + 'T' + String(hour).padStart(2, '0') + ':00', temperature,
      apparent_temperature: temperature + 1, humidity: 62 + (hour % 4) * 3,
      weather_code: index === 0 && hour >= 15 ? 2 : day.weather_code,
      wind_speed: 6 + hour % 5, is_day: hour >= 6 && hour < 19,
      precipitation_probability: day.precipitation_probability, wind_direction: 345,
      wind_gusts: 24, pressure: 1021, visibility: 17000,
      uv_index: hour >= 7 && hour <= 18 ? Math.max(0, 6 - Math.abs(hour - 13)) : 0,
    };
  }));
  const current = { ...hourly[sky[1] ? 12 : 21], temperature: 22, apparent_temperature: 23, humidity: 70, weather_code: sky[0], wind_speed: 6, is_day: sky[1] };
  return { timezone: 'Asia/Shanghai', timezone_abbreviation: 'CST', source: 'network', current, days, hourly };
}
