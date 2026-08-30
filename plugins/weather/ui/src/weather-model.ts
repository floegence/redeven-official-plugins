export type SupportedLocale = "en-US" | "zh-CN";

export type MajorCityRegion =
  | "asia"
  | "middle-east"
  | "oceania"
  | "europe"
  | "africa"
  | "north-america"
  | "south-america";

export type MajorCityLocation = {
  id: string;
  name: string;
  admin1: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  region: MajorCityRegion;
};

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
    chooseLocation: "Choose location",
    currentLocation: "Current location",
    majorCities: "Major cities",
    closeLocationPicker: "Close location picker",
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
    refreshFailed: "Showing saved weather; the latest update is unavailable.",
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
    chooseLocation: "选择城市",
    currentLocation: "当前城市",
    majorCities: "全球主要城市",
    closeLocationPicker: "关闭城市选择",
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
    refreshFailed: "正在显示缓存天气，暂时无法获取最新数据。",
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

type MajorCityDefinition = Omit<MajorCityLocation, "name" | "admin1" | "country"> & {
  en: Pick<MajorCityLocation, "name" | "admin1" | "country">;
  zh: Pick<MajorCityLocation, "name" | "admin1" | "country">;
};

const majorCityDefinitions: readonly MajorCityDefinition[] = [
  { id: "preset:beijing", latitude: 39.9042, longitude: 116.4074, timezone: "Asia/Shanghai", region: "asia", en: { name: "Beijing", admin1: "Beijing", country: "China" }, zh: { name: "北京", admin1: "北京市", country: "中国" } },
  { id: "preset:tokyo", latitude: 35.6762, longitude: 139.6503, timezone: "Asia/Tokyo", region: "asia", en: { name: "Tokyo", admin1: "Tokyo", country: "Japan" }, zh: { name: "东京", admin1: "东京都", country: "日本" } },
  { id: "preset:singapore", latitude: 1.3521, longitude: 103.8198, timezone: "Asia/Singapore", region: "asia", en: { name: "Singapore", admin1: "", country: "Singapore" }, zh: { name: "新加坡", admin1: "", country: "新加坡" } },
  { id: "preset:dubai", latitude: 25.2048, longitude: 55.2708, timezone: "Asia/Dubai", region: "middle-east", en: { name: "Dubai", admin1: "Dubai", country: "United Arab Emirates" }, zh: { name: "迪拜", admin1: "迪拜酋长国", country: "阿联酋" } },
  { id: "preset:sydney", latitude: -33.8688, longitude: 151.2093, timezone: "Australia/Sydney", region: "oceania", en: { name: "Sydney", admin1: "New South Wales", country: "Australia" }, zh: { name: "悉尼", admin1: "新南威尔士州", country: "澳大利亚" } },
  { id: "preset:london", latitude: 51.5074, longitude: -0.1278, timezone: "Europe/London", region: "europe", en: { name: "London", admin1: "England", country: "United Kingdom" }, zh: { name: "伦敦", admin1: "英格兰", country: "英国" } },
  { id: "preset:paris", latitude: 48.8566, longitude: 2.3522, timezone: "Europe/Paris", region: "europe", en: { name: "Paris", admin1: "Île-de-France", country: "France" }, zh: { name: "巴黎", admin1: "法兰西岛大区", country: "法国" } },
  { id: "preset:cairo", latitude: 30.0444, longitude: 31.2357, timezone: "Africa/Cairo", region: "africa", en: { name: "Cairo", admin1: "Cairo", country: "Egypt" }, zh: { name: "开罗", admin1: "开罗省", country: "埃及" } },
  { id: "preset:cape-town", latitude: -33.9249, longitude: 18.4241, timezone: "Africa/Johannesburg", region: "africa", en: { name: "Cape Town", admin1: "Western Cape", country: "South Africa" }, zh: { name: "开普敦", admin1: "西开普省", country: "南非" } },
  { id: "preset:new-york", latitude: 40.7128, longitude: -74.006, timezone: "America/New_York", region: "north-america", en: { name: "New York", admin1: "New York", country: "United States" }, zh: { name: "纽约", admin1: "纽约州", country: "美国" } },
  { id: "preset:los-angeles", latitude: 34.0522, longitude: -118.2437, timezone: "America/Los_Angeles", region: "north-america", en: { name: "Los Angeles", admin1: "California", country: "United States" }, zh: { name: "洛杉矶", admin1: "加利福尼亚州", country: "美国" } },
  { id: "preset:sao-paulo", latitude: -23.5505, longitude: -46.6333, timezone: "America/Sao_Paulo", region: "south-america", en: { name: "São Paulo", admin1: "São Paulo", country: "Brazil" }, zh: { name: "圣保罗", admin1: "圣保罗州", country: "巴西" } },
] as const;

export function majorCitiesForLocale(locale: SupportedLocale): MajorCityLocation[] {
  return majorCityDefinitions.map(({ en, zh, ...location }) => ({
    ...location,
    ...(locale === "zh-CN" ? zh : en),
  }));
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
