import { For, Show, createEffect, onCleanup, onMount } from "solid-js";
import { createMutable } from "solid-js/store";
import { render as mount } from "solid-js/web";
import { FloeProvider } from "@floegence/floe-webapp-core/app";
import { deferAfterPaint, useTheme } from "@floegence/floe-webapp-core";
import { Search, X, Check, ChevronRight, MapPinIcon, Globe, Trash } from "@floegence/floe-webapp-core/icons";
import { Button, Dialog, Input } from "@floegence/floe-webapp-core/ui";
import { PluginBridgeClient, PluginBridgeError, type PluginMethodResult } from "@floegence/redevplugin-ui/plugin";
import "@floegence/floe-webapp-core/styles";
import "../styles.css";
import { WeatherIcon, MetricIllustration } from "./weather-visuals";
import { drawWeatherChart } from "./weather-chart.js";
import {
  conditionForCode, formatMessage, formatCivilDate, localizedLocation,
  localeForLanguageTag, majorCitiesForLocale, translationsForLocale,
  type MajorCityLocation, type SupportedLocale, type WeatherMessageKey,
  type WeatherTranslations,
} from "./weather-model.js";

type Location = MajorCityLocation;

type CurrentWeather = {
  time: string;
  temperature: number;
  apparent_temperature: number;
  humidity: number;
  weather_code: number;
  wind_speed: number;
  is_day: boolean;
};

type ForecastDay = {
  date: string;
  weather_code: number;
  temperature_max: number;
  temperature_min: number;
  precipitation_probability: number;
  sunrise: string;
  sunset: string;
  precipitation_sum?: number | null;
};

type ForecastHour = CurrentWeather & {
  precipitation_probability: number;
  wind_direction: number | null;
  wind_gusts: number | null;
  pressure: number | null;
  visibility: number | null;
  uv_index: number | null;
};

type Forecast = {
  timezone: string;
  timezone_abbreviation: string;
  source: "network" | "saved";
  current: CurrentWeather;
  days: ForecastDay[];
  hourly?: ForecastHour[];
};

type LocationSummary = {
  location_id: string;
  current: CurrentWeather;
  today: ForecastDay | null;
};
type StateLoad = {
  location_summaries?: LocationSummary[];
  favorites: Location[];
  selected: Location | null;
  forecast: Forecast | null;
};
type LocationsResult = { locations: Location[] };
type FavoritesResult = { favorites: Location[] };
type ForecastResult = {
  location: Location;
  forecast: Forecast;
  favorites: Location[];
};
type BusyState = "initial" | "search" | "forecast" | "remove";
type Notice = {
  scope: "chooser" | "weather";
  text: WeatherMessageKey;
  error?: boolean;
};

const bridge = new PluginBridgeClient({ timeoutMs: 20_000 });
const state = createMutable<{
  colorScheme: "light" | "dark";
  locale: SupportedLocale;
  favorites: Location[];
  results: Location[];
  searched: boolean;
  managingLocations: boolean;
  selected?: Location;
  pendingLocation?: Location;
  queuedLocation?: Location;
  forecast?: Forecast;
  query: string;
  notice?: Notice;
  busy?: BusyState;
  now: Date;
  chooserOpen: boolean;
  sidebarCollapsed: boolean;
  detail?: string;
  detailDay: number;
  apparent: boolean;
  cityForecasts: Record<string, Pick<Forecast, "current" | "days">>;
}>({
  colorScheme: "light",
  locale: "en-US",
  favorites: [],
  results: [],
  searched: false,
  managingLocations: false,
  query: "",
  busy: "initial",
  now: new Date(),
  chooserOpen: false,
  sidebarCollapsed: false,
  detailDay: 0,
  apparent: false,
  cityForecasts: {},
});

let disposed = false;
let searchRevision = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;

async function initialize(): Promise<void> {
  await bridge.ready();
  bridge.onContext((context) => {
    state.colorScheme = context.appearance.color_scheme;
    document.documentElement.dir = context.locale.direction;
    const locale = localeForLanguageTag(context.locale.language_tag);
    if (locale === state.locale) return;
    state.locale = locale;
    state.results = [];
    state.searched = false;
    searchRevision++;
  });
  clockTimer = setInterval(() => {
    const next = new Date();
    if (
      next.getMinutes() === state.now.getMinutes() &&
      next.getHours() === state.now.getHours()
    )
      return;
    state.now = next;

  }, 15_000);
  await afterPaint();
  try {
    const response = await bridge.call<PluginMethodResult<StateLoad>>(
      "weather.state.load",
      {},
    );
    state.favorites = response.data.favorites;
    state.selected = response.data.selected ?? undefined;
    state.forecast = response.data.forecast ?? undefined;
    for (const summary of response.data.location_summaries ?? []) {
      state.cityForecasts[summary.location_id] = {
        current: summary.current,
        days: summary.today ? [summary.today] : [],
      };
    }
    if (state.selected && state.forecast)
      state.cityForecasts[state.selected.id] = state.forecast;
    state.busy = undefined;
    if (response.data.selected) {
      await afterPaint();
      void loadForecast(response.data.selected, { preserveVisible: true });
    } else {
      await afterPaint();
    }
  } catch (error) {
    state.busy = undefined;
    state.notice = {
      scope: "chooser",
      text: friendlyError(error, "load"),
      error: true,
    };
    await afterPaint();
  }
}

async function searchLocations(): Promise<void> {
  if (disposed || state.busy) return;
  const query = state.query.trim();
  state.query = query;
  if ([...query].length < 2) {
    state.notice = { scope: "chooser", text: "searchHint" };
    state.results = [];
    await afterPaint();
    return;
  }
  const revision = ++searchRevision;
  state.busy = "search";
  state.results = [];
  state.searched = true;
  state.notice = undefined;
  await afterPaint();
  try {
    const searchLocale = state.locale;
    const language = searchLocale.split("-")[0];
    const response = await bridge.call<PluginMethodResult<LocationsResult>>(
      "weather.locations.search",
      { query, language },
    );
    if (disposed || revision !== searchRevision || state.locale !== searchLocale) return;
    state.results = response.data.locations;
    state.notice =
      state.results.length === 0
        ? { scope: "chooser", text: "noResults" }
        : undefined;
  } catch (error) {
    if (disposed || revision !== searchRevision) return;
    state.results = [];
    state.notice = {
      scope: "chooser",
      text: friendlyError(error, "search"),
      error: true,
    };
  } finally {
    state.busy = undefined;
    await afterPaint();
  }
}

async function previewLocation(event: string): Promise<void> {
  const location = locationForAction(event);
  if (!location) return;
  await loadForecast(location);
}

async function openLocation(event: string): Promise<void> {
  const location = state.favorites.find(
    (item) => item.id === event,
  );
  if (
    !location ||
    state.pendingLocation?.id === location.id ||
    (state.selected?.id === location.id && !state.pendingLocation)
  )
    return;
  await loadForecast(location);
}

async function refreshWeather(): Promise<void> {
  if (state.busy || !state.selected) return;
  await loadForecast(state.selected, { preserveVisible: true });
}

async function removeLocation(event: string): Promise<void> {
  if (disposed || state.busy) return;
  const id = event;
  if (!isFavorite(id)) return;
  state.busy = "remove";
  state.notice = undefined;
  await afterPaint();
  try {
    const response = await bridge.call<PluginMethodResult<FavoritesResult>>(
      "weather.locations.remove",
      { id },
    );
    state.favorites = response.data.favorites;
  } catch (error) {
    state.notice = {
      scope: "chooser",
      text: friendlyError(error, "remove"),
      error: true,
    };
  } finally {
    state.busy = undefined;
    await afterPaint();
  }
}

async function clearSearch(): Promise<void> {
  searchRevision++;
  state.searched = false;
  state.query = "";
  state.results = [];
  state.notice = undefined;
  await afterPaint();
}

async function toggleLocationChooser(): Promise<void> {
  state.chooserOpen = !state.chooserOpen;
  if (!state.chooserOpen) {
    searchRevision++;
    state.searched = false;
    state.managingLocations = false;
    state.query = "";
    state.results = [];
    state.notice = undefined;
  }
  await afterPaint();
}

async function loadForecast(
  location: Location,
  options: { preserveVisible?: boolean } = {},
): Promise<void> {
  if (disposed) return;
  if (state.busy === "forecast") {
    state.queuedLocation = location;
    state.pendingLocation = location;
    state.notice = undefined;
    await afterPaint();
    return;
  }
  if (disposed || state.busy) return;
  const preserveVisible = Boolean(
    options.preserveVisible &&
      state.forecast &&
      state.selected?.id === location.id,
  );
  state.busy = "forecast";
  state.notice = undefined;
  state.pendingLocation = options.preserveVisible ? undefined : location;
  await afterPaint();
  try {
    const response = await bridge.call<PluginMethodResult<ForecastResult>>(
      "weather.forecast",
      {
        id: location.id,
        name: location.name,
        admin1: location.admin1,
        country: location.country,
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: location.timezone,
      },
    );
    if (disposed || state.queuedLocation) return;
    state.selected = response.data.location;
    state.forecast = response.data.forecast;
    state.notice =
      response.data.forecast.source === "saved"
        ? { scope: "weather", text: "refreshFailed" }
        : undefined;
    state.cityForecasts[response.data.location.id] = response.data.forecast;
    state.detail = undefined;
    state.favorites = response.data.favorites;
    state.results = [];
    state.searched = false;
    state.managingLocations = false;
    state.query = "";
    if (state.pendingLocation) state.chooserOpen = false;
  } catch (error) {
    if (disposed || state.queuedLocation) return;
    const message =
      preserveVisible && state.forecast
        ? ("refreshFailed" as const)
        : friendlyError(error, "forecast");
    state.notice = {
      scope: state.forecast && !state.chooserOpen ? "weather" : "chooser",
      text: message,
      error: true,
    };
  } finally {
    const queuedLocation = state.queuedLocation;
    state.busy = undefined;
    state.pendingLocation = undefined;
    state.queuedLocation = undefined;
    if (queuedLocation && !disposed) await loadForecast(queuedLocation);
    else await afterPaint();
  }
}

type MetricItem = {
  id: string;
  label: string;
  symbol: string;
  value: string;
  note: string;
};
function metricItems(): MetricItem[] {
  const forecast = state.forecast;
  if (!forecast) return [];
  const t = translations();
  const current = forecast.current;
  const day = forecast.days[0];
  const hour = upcomingHours(forecast)[0];
  const result: MetricItem[] = [
    {
      id: "wind",
      label: t.wind,
      symbol: "≋",
      value: `${number(current.wind_speed)} ${message("windUnit")}`,
      note:
        hour?.wind_gusts != null
          ? message("gusts", {
              speed: `${number(hour.wind_gusts)} ${message("windUnit")}`,
            })
          : message("currentWind"),
    },
    {
      id: "feels-like",
      label: t.feelsLike,
      symbol: "♨",
      value: degrees(current.apparent_temperature),
      note: message("actualTemperature", {
        temperature: degrees(current.temperature),
      }),
    },
    {
      id: "humidity",
      label: t.humidity,
      symbol: "◉",
      value: `${Math.round(current.humidity)}%`,
      note: message("relativeHumidity"),
    },
  ];
  if (day)
    result.splice(
      1,
      0,
      {
        id: "sunset",
        label: message("sunset"),
        symbol: "☀",
        value: day.sunset.slice(11, 16) || "—",
        note: `${message("sunrise")} ${day.sunrise.slice(11, 16) || "—"}`,
      },
      {
        id: "rain",
        label: message("precipitationTotal"),
        symbol: "☂",
        value:
          day.precipitation_sum != null
            ? `${number(day.precipitation_sum, 1)} ${message("millimeters")}`
            : `${Math.round(day.precipitation_probability)}%`,
        note: message("chanceToday", {
          chance: `${number(day.precipitation_probability)}%`,
        }),
      },
    );
  if (hour?.uv_index != null)
    result.push({
      id: "uv",
      label: message("uv"),
      symbol: "☀",
      value: String(Math.round(hour.uv_index)),
      note:
        hour.uv_index < 3
          ? message("lowUV")
          : hour.uv_index < 6
            ? message("moderateUV")
            : hour.uv_index < 8
              ? message("highUV")
              : message("veryHighUV"),
    });
  if (hour?.visibility != null)
    result.push({
      id: "visibility",
      label: message("visibility"),
      symbol: "◌",
      value: `${Math.round(hour.visibility / 1000)} ${message("kilometers")}`,
      note: message("horizontalVisibility"),
    });
  if (hour?.pressure != null)
    result.push({
      id: "pressure",
      label: message("pressure"),
      symbol: "◴",
      value: `${Math.round(hour.pressure)} hPa`,
      note: message("seaLevel"),
    });
  return result;
}

function detailChartData() {
  const forecast = state.forecast;
  const day = forecast?.days[state.detailDay];
  const samples = (forecast?.hourly ?? [])
    .filter((hour) => hour.time.startsWith(day?.date ?? "missing"))
    .flatMap((hour) => {
      const value =
        state.detail === "temperature"
          ? state.apparent
            ? hour.apparent_temperature
            : hour.temperature
          : state.detail === "feels-like"
            ? hour.apparent_temperature
            : state.detail === "humidity"
              ? hour.humidity
              : state.detail === "wind"
                ? hour.wind_speed
                : state.detail === "rain"
                  ? hour.precipitation_probability
                  : state.detail === "uv"
                    ? hour.uv_index
                    : state.detail === "visibility"
                      ? hour.visibility == null
                        ? null
                        : hour.visibility / 1000
                      : hour.pressure;
      return value == null ? [] : [{ time: hour.time, value }];
    });
  const values = samples.map((sample) => sample.value);
  const isTemperature =
    state.detail === "temperature" || state.detail === "feels-like";
  const minimum = Math.max(
    isTemperature ? -Infinity : 0,
    Math.min(...values) - 2,
  );
  const maximum = Math.min(
    state.detail === "humidity" || state.detail === "rain" ? 100 : Infinity,
    Math.max(...values) + 2,
  );
  return { samples, values, minimum, maximum };
}

function locationForAction(event: string): Location | undefined {
  const id = event;
  return (
    state.results.find((item) => item.id === id) ??
    state.favorites.find((item) => item.id === id) ??
    majorCitiesForLocale(state.locale).find((item) => item.id === id) ??
    (state.selected?.id === id ? state.selected : undefined)
  );
}

function isFavorite(id: string): boolean {
  return state.favorites.some((item) => item.id === id);
}

function translations(): WeatherTranslations {
  return translationsForLocale(state.locale);
}

function pendingLocationLabel(t: WeatherTranslations): string {
  return t.loadingLocation.replace(
    "{city}",
    (state.pendingLocation
      ? localizedLocation(state.pendingLocation, state.locale).name
      : undefined) ?? "",
  );
}

function translatedCondition(
  kind: ReturnType<typeof conditionForCode>["kind"],
): string {
  return translations().conditions[kind];
}

function locationSubtitle(location: Location): string {
  const localized = localizedLocation(location, state.locale);
  return [
    ...new Set([localized.admin1, localized.country].filter(Boolean)),
  ].join(", ");
}

function friendlyError(
  error: unknown,
  operation: "load" | "search" | "remove" | "forecast",
): WeatherMessageKey {
  if (
    error instanceof PluginBridgeError &&
    ["PLUGIN_PERMISSION_DENIED", "permission_required"].includes(error.errorCode)
  ) {
    return "permission";
  }
  if (operation === "search") return "searchError";
  if (operation === "forecast") return "unavailable";
  return "unavailable";
}

function formatTime(date: Date, timezone?: string): string {
  return safeDateFormat(date, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

function formatForecastDay(value: string): string {
  return formatCivilDate(value, state.locale, true);
}

function safeDateFormat(
  date: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(state.locale, options).format(date);
  } catch {
    const { timeZone: _timeZone, ...fallback } = options;
    return new Intl.DateTimeFormat(state.locale, fallback).format(date);
  }
}

function number(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(state.locale, {
    maximumFractionDigits: fractionDigits,
    useGrouping: false,
  }).format(value);
}
function degrees(value: number): string {
  return `${number(value)}°`;
}


function openDetail(id: string) {
  if (!metricItems().some((item) => item.id === id)) return;
  state.detailDay = 0;
  state.detail = id;
}
function openDay(index: number) {
  if (!Number.isInteger(index) || !state.forecast?.days[index]) return;
  state.detailDay = index;
  state.detail = "temperature";
}
function upcomingHours(forecast: Forecast) {
  // Provider timestamps are local wall times, not browser-zone timestamps.
  return (forecast.hourly ?? []).filter((hour) => hour.time >= forecast.current.time.slice(0, 13) + ":00").slice(0, 24);
}
function weatherClass(current?: CurrentWeather) {
  return current ? "sky-" + conditionForCode(current.weather_code, current.is_day).kind + (current.is_day ? "" : " weather-night") : "sky-neutral";
}
function sunProgress() {
  const forecast = state.forecast, day = forecast?.days[0];
  if (!forecast || !day) return 0;
  const minutes = (value: string) => Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
  return Math.max(0, Math.min(1, (minutes(forecast.current.time) - minutes(day.sunrise)) / Math.max(1, minutes(day.sunset) - minutes(day.sunrise))));
}
function LocationButton(props: { location: Location; source: "major" | "result" | "favorite" }) {
  const current = () => state.selected?.id === props.location.id;
  const pending = () => state.pendingLocation?.id === props.location.id;
  const summary = () => state.cityForecasts[props.location.id];
  const select = () => {
    if (current() && !state.pendingLocation && state.chooserOpen) { void toggleLocationChooser(); return; }
    void (props.source === "favorite" ? openLocation(props.location.id) : previewLocation(props.location.id));
  };
  return <Button variant="ghost" class="location-choice" data-location-id={props.location.id}
    aria-current={current() ? "true" : undefined} aria-busy={pending()} title={localizedLocation(props.location, state.locale).name + " · " + locationSubtitle(props.location)}
    disabled={Boolean(state.busy && state.busy !== "forecast")} onClick={select}>
    <Show when={props.source !== "major"}><span class="location-marker" aria-hidden="true"><MapPinIcon size={18} /></span></Show>
    <span class="location-copy"><span class="location-name"><strong>{localizedLocation(props.location, state.locale).name}</strong>
      <Show when={current()}><span class="current-label">{message("currentLocation")}</span></Show>
    </span><small title={locationSubtitle(props.location)}>{props.source === "major" ? localizedLocation(props.location, state.locale).country : locationSubtitle(props.location)}</small></span>
    <Show when={props.source === "favorite" && summary()}>{(weather) => <span class="location-weather" title={weather().current.time.replace("T", " ")}>
      <WeatherIcon code={weather().current.weather_code} day={weather().current.is_day} label={translatedCondition(conditionForCode(weather().current.weather_code, weather().current.is_day).kind)} />
      <span>{degrees(weather().current.temperature)}</span></span>}</Show>
    <span class="location-trailing" aria-hidden="true"><Show when={pending()} fallback={<Show when={current()} fallback={<ChevronRight size={16} />}><Check size={16} /></Show>}><span class="loading-mark" /></Show></span>
  </Button>;
}
function LocationPicker() {
  let queryInput!: HTMLInputElement;
  const status = () => {
    if (state.pendingLocation) return pendingLocationLabel(translations());
    // Empty search states own their feedback; populated results still need errors.
    if (state.notice?.scope === "chooser" && (!state.searched || state.results.length > 0)) return message(state.notice.text);
    return "";
  };
  const suggested = () => majorCitiesForLocale(state.locale).filter((city) => !state.favorites.some((favorite) => favorite.id === city.id));
  const clear = () => { void clearSearch(); queryInput.focus(); };
  return <section class="location-picker" aria-label={translations().chooseLocation}>
    <div class="picker-search-area">
      <p class="picker-intro">{message("pickerHint")}</p>
      <form class="search-form" onSubmit={(event) => { event.preventDefault(); void searchLocations(); }}>
        <div class="search-input-wrap"><Search size={18} class="search-icon" aria-hidden="true" />
          <label class="sr-only" for="weather-query">{translations().searchPlaceholder}</label>
          <Input ref={queryInput} id="weather-query" name="query" type="search" value={state.query}
            onInput={(event) => { state.query = event.currentTarget.value; if (state.searched) { searchRevision++; state.searched = false; state.results = []; state.notice = undefined; } }}
            placeholder={translations().searchPlaceholder} maxLength={120} autocomplete="off" enterkeyhint="search" spellcheck={false}
            disabled={Boolean(state.busy && state.busy !== "search")} />
          <Show when={state.query}><Button variant="ghost" class="clear-search" type="button" aria-label={message("clearSearch")} onClick={clear}><X size={16} aria-hidden="true" /></Button></Show>
        </div>
        <Button type="submit" class="search-submit" disabled={Boolean(state.busy)} aria-label={translations().search} aria-busy={state.busy === "search"}>
          <Show when={state.busy === "search"} fallback={<ChevronRight size={20} aria-hidden="true" />}><span class="loading-mark" aria-hidden="true" /></Show>
        </Button>
      </form>
      <p class="chooser-status" classList={{ error: state.notice?.scope === "chooser" && Boolean(state.notice.error), "has-status": Boolean(status()) }} role="status" aria-atomic="true">{status()}</p>
    </div>
    <div class="picker-scroll">
      <Show when={state.searched} fallback={<>
        <Show when={state.favorites.length}>
          <section class="picker-section recent-locations" aria-label={translations().favorites}>
            <div class="picker-section-heading"><h3>{translations().favorites}<span class="location-count">{state.favorites.length}</span></h3>
              <Button variant="ghost" class="manage-locations" onClick={() => { state.managingLocations = !state.managingLocations; }}>{message(state.managingLocations ? "done" : "manageLocations")}</Button>
            </div>
            <ul class="location-list recent-list"><For each={state.favorites}>{(location) => <li>
              <LocationButton location={location} source="favorite" />
              <Show when={state.managingLocations}><Button variant="ghost" class="remove-location" disabled={Boolean(state.busy)}
                aria-label={translations().remove + " " + localizedLocation(location, state.locale).name} title={message("removeRecent")}
                onClick={() => void removeLocation(location.id)}><Trash size={17} aria-hidden="true" /></Button></Show>
            </li>}</For></ul>
          </section>
        </Show>
        <Show when={suggested().length}><section class="picker-section suggested-locations" aria-label={translations().majorCities}>
          <div class="picker-section-heading"><h3>{translations().majorCities}</h3><span class="section-decoration" aria-hidden="true"><Globe size={15} /></span></div>
          <ul class="location-list suggested-list"><For each={suggested()}>{(location) => <li><LocationButton location={location} source="major" /></li>}</For></ul>
        </section></Show>
      </>}>
        <section class="picker-section search-results" aria-label={message("searchResults")}>
          <div class="picker-section-heading"><h3>{message("searchResults")}<Show when={state.busy !== "search"}><span class="location-count">{state.results.length}</span></Show></h3></div>
          <Show when={state.results.length} fallback={<div class="location-empty" role="status" aria-atomic="true"><Search size={28} aria-hidden="true" /><p>{state.busy === "search" ? translations().searching : state.notice?.error ? message(state.notice.text) : translations().noResults}</p><Show when={state.busy !== "search"}><small>{message("searchRetryHint")}</small></Show></div>}>
            <ul class="location-list results-list"><For each={state.results}>{(location) => <li><LocationButton location={location} source="result" /></li>}</For></ul>
          </Show>
        </section>
      </Show>
    </div>
  </section>;
}
function CitySidebar() {
  return <aside class="city-sidebar" aria-label={translations().favorites}>
    <div class="sidebar-toolbar"><strong>{message("weather")}</strong>
      <Button variant="ghost" aria-label={message("hideSidebar")} onClick={() => { state.sidebarCollapsed = true; }}>◧</Button>
    </div>
    <Button variant="outline" class="sidebar-search" onClick={() => void toggleLocationChooser()}>{translations().searchPlaceholder}</Button>
    <nav class="city-list"><For each={state.favorites}>{(location) => <button type="button" class={"city-card " + weatherClass(state.cityForecasts[location.id]?.current)}
      data-city-id={location.id} aria-pressed={(state.pendingLocation ?? state.selected)?.id === location.id}
      aria-busy={state.pendingLocation?.id === location.id} onClick={() => void openLocation(location.id)}>
      <strong>{localizedLocation(location, state.locale).name}</strong><time>{formatTime(state.now, location.timezone)}</time>
      <span class="city-temperature">{state.cityForecasts[location.id] ? degrees(state.cityForecasts[location.id].current.temperature) : "—"}</span>
      <span class="city-condition">{state.cityForecasts[location.id] ? translatedCondition(conditionForCode(state.cityForecasts[location.id].current.weather_code, state.cityForecasts[location.id].current.is_day).kind) : location.country}</span>
      <Show when={state.cityForecasts[location.id]?.days[0]}>{(day) => <small>{translations().high} {degrees(day().temperature_max)} · {translations().low} {degrees(day().temperature_min)}</small>}</Show>
    </button>}</For></nav>
  </aside>;
}
function WeatherToolbar() {
  return <div class="weather-toolbar">
    <Show when={state.sidebarCollapsed}><Button variant="ghost" aria-label={message("toggleSidebar")} onClick={() => { state.sidebarCollapsed = false; }}>◧</Button></Show>
    <Button variant="outline" aria-label={translations().chooseLocation} aria-expanded={state.chooserOpen}
      onClick={() => void toggleLocationChooser()}>{state.selected ? localizedLocation(state.selected, state.locale).name : translations().chooseLocation} <span aria-hidden="true">⌄</span></Button>
    <p class="weather-progress" role="status"><Show when={state.pendingLocation && !state.chooserOpen}>{pendingLocationLabel(translations())}</Show></p>
    <Button variant="ghost" aria-label={state.busy === "forecast" && !state.pendingLocation ? translations().refreshing : translations().refresh}
      disabled={Boolean(state.busy)} aria-busy={state.busy === "forecast" && !state.pendingLocation} onClick={() => void refreshWeather()}><span aria-hidden="true">↻</span></Button>
  </div>;
}
function ForecastRow(props: { day: ForecastDay; index: number; forecast: Forecast }) {
  const low = () => Math.min(...props.forecast.days.map((day) => day.temperature_min));
  const span = () => Math.max(1, Math.max(...props.forecast.days.map((day) => day.temperature_max)) - low());
  return <li><button type="button" class="forecast-row" onClick={() => openDay(props.index)}>
    <span>{props.index === 0 ? translations().today : formatForecastDay(props.day.date)}</span>
    <span class="day-condition"><WeatherIcon code={props.day.weather_code} label={translatedCondition(conditionForCode(props.day.weather_code, true).kind)} /><Show when={props.day.precipitation_probability >= 20}><small>{Math.round(props.day.precipitation_probability)}%</small></Show></span>
    <span>{degrees(props.day.temperature_min)}</span>
    <span class="range-track" aria-hidden="true"><span class="temperature-range" style={{ left: ((props.day.temperature_min - low()) / span() * 100) + "%", width: ((props.day.temperature_max - props.day.temperature_min) / span() * 100) + "%" }} /><Show when={props.index === 0}><span class="current-dot" style={{ left: (Math.max(0, Math.min(1, (props.forecast.current.temperature - low()) / span())) * 100) + "%" }} /></Show></span>
    <span>{degrees(props.day.temperature_max)}</span>
  </button></li>;
}
function Dashboard() {
  return <article class="forecast-dashboard">
    <WeatherToolbar />
    <header class="weather-hero"><h1 data-testid="place-name">{state.selected ? localizedLocation(state.selected, state.locale).name : ""}</h1>
      <span class="current-temperature">{state.forecast ? degrees(state.forecast.current.temperature) : ""}</span>
      <p>{state.forecast ? translatedCondition(conditionForCode(state.forecast.current.weather_code, state.forecast.current.is_day).kind) : ""}</p>
      <Show when={state.forecast?.days[0]}>{(day) => <p class="hero-range">{translations().high} {degrees(day().temperature_max)} · {translations().low} {degrees(day().temperature_min)}</p>}</Show>
    </header>
    <Show when={state.notice?.scope === "weather"}><p class="weather-alert" role={state.notice?.error ? "alert" : "status"}>{state.notice ? message(state.notice.text) : ""}</p></Show>
    <div class="weather-grid">
      <Show when={state.forecast && upcomingHours(state.forecast).length}>
        <section class="weather-card hourly-card" aria-label={message("hourly")}><h2>{message("hourly")}</h2>
          <ol class="hourly-list"><For each={state.forecast ? upcomingHours(state.forecast) : []}>{(hour, index) => <li><button type="button"
            onClick={() => openDay(state.forecast?.days.findIndex((day) => hour.time.startsWith(day.date)) ?? -1)}>
            <span>{index() === 0 ? message("now") : hour.time.slice(11, 16)}</span><WeatherIcon code={index() === 0 ? state.forecast!.current.weather_code : hour.weather_code} day={index() === 0 ? state.forecast!.current.is_day : hour.is_day} label={translatedCondition(conditionForCode(index() === 0 ? state.forecast!.current.weather_code : hour.weather_code, index() === 0 ? state.forecast!.current.is_day : hour.is_day).kind)} />
            <strong>{degrees(index() === 0 ? state.forecast!.current.temperature : hour.temperature)}</strong><Show when={hour.precipitation_probability >= 20}><small>{Math.round(hour.precipitation_probability)}%</small></Show>
          </button></li>}</For></ol>
        </section>
      </Show>
      <section class="weather-card weekly-forecast" aria-label={translations().forecastLabel}><h2>{state.forecast?.days.length === 10 ? translations().forecastTitle : message("daysForecast", { count: state.forecast?.days.length ?? 0 })}</h2>
        <ol class="forecast-list"><For each={state.forecast?.days ?? []}>{(day, index) => <ForecastRow day={day} index={index()} forecast={state.forecast!} />}</For></ol>
      </section>
      <section class="metrics-grid" aria-label={translations().detailsLabel}><For each={metricItems()}>{(item) => <button type="button" class={"weather-card metric metric-" + item.id}
        data-metric={item.id} aria-label={item.label + ": " + item.value} onClick={() => openDetail(item.id)}>
        <span class="card-label">{item.symbol} {item.label}</span><strong class="metric-value">{item.value}</strong>
        <MetricIllustration id={item.id} humidity={state.forecast!.current.humidity} direction={upcomingHours(state.forecast!)[0]?.wind_direction}
          uv={upcomingHours(state.forecast!)[0]?.uv_index} pressure={upcomingHours(state.forecast!)[0]?.pressure}
          sunProgress={sunProgress()} compassLabels={[message("north"), message("east"), message("south"), message("west")]} />
        <span class="metric-note">{item.note}<Show when={item.id === "wind" && state.forecast && upcomingHours(state.forecast)[0]?.wind_direction != null}> · {state.forecast ? number(upcomingHours(state.forecast)[0].wind_direction!) : ""}°</Show></span>
      </button>}</For></section>
    </div>
  </article>;
}
function DetailChart() {
  let canvas!: HTMLCanvasElement;
  const paint = () => {
    const { samples, minimum, maximum } = detailChartData();
    const context = canvas?.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    drawWeatherChart(context, samples, width, height, minimum, maximum, getComputedStyle(canvas).color);
  };
  createEffect(() => { detailChartData(); state.colorScheme; queueMicrotask(paint); });
  onMount(() => { const observer = new ResizeObserver(paint); observer.observe(canvas); onCleanup(() => observer.disconnect()); paint(); });
  return <div class="hourly-chart"><canvas ref={canvas} class="chart-canvas" aria-hidden="true" />
    <div class="chart-values" aria-label={message("hourly")}><For each={detailChartData().samples}>{(sample) => <span tabindex="0" title={sample.time.slice(11, 16) + ": " + number(sample.value)}><small>{sample.time.slice(11, 16)}</small><strong>{number(sample.value)}</strong></span>}</For></div>
  </div>;
}
function WeatherDetail() {
  const metric = () => metricItems().find((item) => item.id === state.detail);
  const day = () => state.forecast?.days[state.detailDay];
  const unit = () => state.detail === "temperature" || state.detail === "feels-like" ? "°" : state.detail === "humidity" || state.detail === "rain" ? "%" : state.detail === "wind" ? " " + message("windUnit") : state.detail === "visibility" ? " " + message("kilometers") : state.detail === "pressure" ? " hPa" : "";
  const value = () => {
    if (state.detail === "temperature" && state.detailDay === 0 && state.forecast) return degrees(state.apparent ? state.forecast.current.apparent_temperature : state.forecast.current.temperature);
    if (state.detailDay === 0 && metric()) return metric()!.value;
    const values = detailChartData().values;
    if (metric()) return values.length ? Math.round(Math.min(...values)) + "–" + Math.round(Math.max(...values)) + unit() : "—";
    return day() ? degrees(day()!.temperature_max) + " / " + degrees(day()!.temperature_min) : "—";
  };
  return <Dialog open={Boolean(state.detail)} onOpenChange={(open) => { if (!open) state.detail = undefined; }} title={metric()?.label ?? message("conditionsTitle")}
    closeLabel={message("closeDetails")} escapeKeyPhase="bubble" class="weather-detail">
    <Show when={state.detail !== "sunset"}><nav class="detail-days" aria-label={translations().forecastLabel}><For each={state.forecast?.days ?? []}>{(item, index) =>
      <Button variant="ghost" aria-pressed={index() === state.detailDay} onClick={() => { state.detailDay = index(); }}>{formatForecastDay(item.date)} {Number(item.date.slice(8))}</Button>
    }</For></nav></Show>
    <p class="detail-date">{day() ? formatCivilDate(day()!.date, state.locale) : ""}</p>
    <div class="detail-summary"><strong data-testid="detail-value">{value()}</strong><p>{state.detailDay === 0 && metric() ? metric()!.note : metric() ? message("dailyRange") : day() ? translatedCondition(conditionForCode(day()!.weather_code, true).kind) : ""}</p></div>
    <Show when={state.detail !== "sunset"}>
      <Show when={detailChartData().samples.length} fallback={<p class="detail-note">{message("missingHours")}</p>}><DetailChart /></Show>
    </Show>
    <Show when={state.detail === "temperature"}><div class="temperature-tabs" role="group" aria-label={message("temperatureType")}>
      <Button variant="ghost" aria-pressed={!state.apparent} onClick={() => { state.apparent = false; }}>{message("actual")}</Button>
      <Button variant="ghost" aria-pressed={state.apparent} onClick={() => { state.apparent = true; }}>{translations().feelsLike}</Button>
    </div></Show>
    <p class="detail-note">{translations().poweredBy}</p>
  </Dialog>;
}
function WeatherApp() {
  const theme = useTheme();
  createEffect(() => theme.setTheme(state.colorScheme));
  onMount(() => { void initialize().catch((error) => { if (!disposed) { state.busy = undefined; state.notice = { scope: "chooser", text: friendlyError(error, "load"), error: true }; } }); });
  onCleanup(() => { disposed = true; if (clockTimer !== undefined) clearInterval(clockTimer); });
  return <main lang={state.locale} class={"weather-app " + weatherClass(state.forecast?.current)} classList={{ "sidebar-collapsed": state.sidebarCollapsed }}>
    <div class="weather-sky" aria-hidden="true"><span class="cloud cloud-one" /><span class="cloud cloud-two" /><span class="sky-precipitation" /></div>
    <Show when={state.forecast}><CitySidebar /></Show>
    <div class="weather-content"><Show when={state.forecast && state.selected} fallback={
      <Show when={state.busy !== "initial"} fallback={<section class="loading-state" role="status"><span class="loading-mark" />{translations().loading}</section>}>
        <div class="onboarding"><h1>{translations().onboardingTitle}</h1><p>{translations().onboardingBody}</p><LocationPicker /></div>
      </Show>
    }><Dashboard /></Show>
      <footer class="footer"><span>{translations().poweredBy}</span><Show when={state.forecast}><span>{state.forecast?.source === "saved" ? message("savedWeather") + " · " : ""}{state.forecast?.current.time.replace("T", " ")} · {state.forecast?.timezone}</span></Show></footer>
    </div>
    <Dialog open={Boolean(state.chooserOpen && state.forecast)} onOpenChange={(open) => { if (open !== state.chooserOpen) void toggleLocationChooser(); }} title={translations().chooseLocation} closeLabel={translations().closeLocationPicker} escapeKeyPhase="bubble" class="weather-chooser" contentClass="weather-chooser-body"
      header={<div class="picker-dialog-header"><h2>{translations().chooseLocation}</h2><Button variant="ghost" class="picker-close" aria-label={translations().closeLocationPicker} onClick={() => void toggleLocationChooser()}><X size={20} aria-hidden="true" /></Button></div>}><LocationPicker /></Dialog>
    <WeatherDetail />
  </main>;
}
const root = document.getElementById("app");
if (!root) throw new Error("Weather application root is missing");
const unmount = mount(() => <FloeProvider config={{ theme: { defaultTheme: "light", defaultSurfaceStyle: "soft-neumorphic" }, storage: { namespace: "weather", enabled: false } }}><WeatherApp /></FloeProvider>, root);
bridge.onLifecycle((event) => { if (event.type === "dispose") unmount(); });

function afterPaint(): Promise<void> {
  return new Promise((resolve) => deferAfterPaint(resolve));
}
function message(key: WeatherMessageKey, values: Record<string, string | number> = {}): string {
  return formatMessage(state.locale, key, values);
}
