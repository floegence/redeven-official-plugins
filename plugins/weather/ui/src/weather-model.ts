export type SupportedLocale = "en-US" | "zh-CN";

export type WeatherConditionKind =
  | "clear-day"
  | "clear-night"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm"
  | "unknown";

export type WeatherCondition = {
  kind: WeatherConditionKind;
  symbol: string;
  label: string;
};

export type TemperatureDay = {
  temperature_min: number;
  temperature_max: number;
};

export type TemperatureRangeClasses = {
  startClass: string;
  widthClass: string;
  currentClass: string | undefined;
};

const translations = {
  "en-US": {
    appName: "Weather",
    searchPlaceholder: "Search city or place",
    search: "Search",
    searchHint: "Search for a city to see its local time and seven-day outlook.",
    favorites: "Saved places",
    save: "Save",
    saved: "Saved",
    view: "View",
    remove: "Remove",
    refresh: "Refresh",
    refreshing: "Refreshing…",
    feelsLike: "Feels like",
    humidity: "Humidity",
    wind: "Wind",
    precipitation: "Rain",
    detailsLabel: "Current weather details",
    forecastTitle: "7-day forecast",
    forecastLabel: "Seven-day forecast",
    secureBroker: "Redeven secure network broker",
    today: "Today",
    tonight: "Tonight",
    high: "High",
    low: "Low",
    poweredBy: "Weather data by Open-Meteo.com · CC BY 4.0",
    ready: "Choose a place to begin",
    searching: "Finding places…",
    noResults: "No matching places found.",
    loading: "Loading your weather…",
    updated: "Updated just now",
    savedForecast: "Showing the last saved forecast",
    permission: "Network access is required to load live weather. Grant the plugin’s network permission, then try again.",
    unavailable: "Live weather is unavailable right now. Your saved places are still available.",
    searchError: "Place search is unavailable right now.",
    emptyTitle: "Your weather, at a glance",
    emptyBody: "Search for a place to pair a calm local clock with current conditions and the week ahead.",
    conditions: {
      "clear-day": "Clear sky",
      "clear-night": "Clear sky",
      "partly-cloudy": "Partly cloudy",
      cloudy: "Cloudy",
      fog: "Fog",
      drizzle: "Drizzle",
      rain: "Rain",
      snow: "Snow",
      storm: "Thunderstorm",
      unknown: "Conditions unavailable",
    },
  },
  "zh-CN": {
    appName: "天气",
    searchPlaceholder: "搜索城市或地区",
    search: "搜索",
    searchHint: "搜索城市，查看当地时间和未来七天天气。",
    favorites: "已收藏地点",
    save: "收藏",
    saved: "已收藏",
    view: "查看",
    remove: "移除",
    refresh: "刷新",
    refreshing: "正在刷新…",
    feelsLike: "体感",
    humidity: "湿度",
    wind: "风速",
    precipitation: "降水",
    detailsLabel: "当前天气详情",
    forecastTitle: "未来七天",
    forecastLabel: "未来七天天气预报",
    secureBroker: "由 Redeven 安全网络代理访问",
    today: "今天",
    tonight: "今晚",
    high: "最高",
    low: "最低",
    poweredBy: "天气数据由 Open-Meteo.com 提供 · CC BY 4.0",
    ready: "选择一个地点开始",
    searching: "正在查找地点…",
    noResults: "没有找到匹配地点。",
    loading: "正在加载天气…",
    updated: "刚刚更新",
    savedForecast: "正在显示上次保存的预报",
    permission: "加载实时天气需要网络权限。授权后请重试。",
    unavailable: "暂时无法获取实时天气，你仍可查看已收藏地点。",
    searchError: "暂时无法搜索地点。",
    emptyTitle: "一眼看懂当地天气",
    emptyBody: "搜索一个地点，将当地时钟、实时状况与一周趋势收在同一个界面里。",
    conditions: {
      "clear-day": "晴",
      "clear-night": "晴",
      "partly-cloudy": "多云间晴",
      cloudy: "多云",
      fog: "有雾",
      drizzle: "小雨",
      rain: "有雨",
      snow: "有雪",
      storm: "雷暴",
      unknown: "暂无天气信息",
    },
  },
} as const;

export type WeatherTranslations = (typeof translations)[SupportedLocale];

export function localeForLanguageTag(languageTag: string | undefined): SupportedLocale {
  return languageTag?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function translationsForLocale(locale: SupportedLocale): WeatherTranslations {
  return translations[locale];
}

export function conditionForCode(code: number, isDay: boolean): WeatherCondition {
  if (code === 0) return isDay
    ? { kind: "clear-day", symbol: "☀️", label: "Clear sky" }
    : { kind: "clear-night", symbol: "🌙", label: "Clear sky" };
  if (code === 1 || code === 2) return { kind: "partly-cloudy", symbol: isDay ? "🌤️" : "☁️", label: "Partly cloudy" };
  if (code === 3) return { kind: "cloudy", symbol: "☁️", label: "Cloudy" };
  if (code === 45 || code === 48) return { kind: "fog", symbol: "🌫️", label: "Fog" };
  if (code >= 51 && code <= 57) return { kind: "drizzle", symbol: "🌦️", label: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { kind: "rain", symbol: "🌧️", label: "Rain" };
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return { kind: "snow", symbol: "🌨️", label: "Snow" };
  if (code >= 95 && code <= 99) return { kind: "storm", symbol: "⛈️", label: "Thunderstorm" };
  return { kind: "unknown", symbol: "•", label: "Conditions unavailable" };
}

export function temperatureRangeClasses(
  days: readonly TemperatureDay[],
  day: TemperatureDay,
  currentTemperature?: number,
): TemperatureRangeClasses {
  const globalMinimum = Math.min(...days.map((value) => value.temperature_min));
  const globalMaximum = Math.max(...days.map((value) => value.temperature_max));
  const span = Math.max(1, globalMaximum - globalMinimum);
  const start = boundedStep((day.temperature_min - globalMinimum) / span);
  const end = boundedStep((day.temperature_max - globalMinimum) / span);
  const width = Math.max(1, end - start);
  const current = currentTemperature === undefined
    ? undefined
    : boundedStep((currentTemperature - globalMinimum) / span);
  return {
    startClass: `range-start-${start}`,
    widthClass: `range-width-${width}`,
    currentClass: current === undefined ? undefined : `current-position-${current}`,
  };
}

function boundedStep(value: number): number {
  return Math.max(0, Math.min(10, Math.round(value * 10)));
}
