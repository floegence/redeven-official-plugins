import {
  PluginBridgeClient,
  PluginBridgeError,
  type PluginMethodResult,
  type PluginUIActionEvent,
} from "@floegence/redevplugin-ui/plugin";
import {
  conditionForCode,
  localeForLanguageTag,
  majorCitiesForLocale,
  temperatureRangeClasses,
  translationsForLocale,
  type MajorCityLocation,
  type SupportedLocale,
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
};

type Forecast = {
  timezone: string;
  timezone_abbreviation: string;
  source: "network" | "saved";
  current: CurrentWeather;
  days: ForecastDay[];
};

type StateLoad = { favorites: Location[]; selected: Location | null; forecast: Forecast | null };
type LocationsResult = { locations: Location[] };
type FavoritesResult = { favorites: Location[] };
type ForecastResult = { location: Location; forecast: Forecast };
type BusyState = "initial" | "search" | "forecast" | "save";

const bridge = new PluginBridgeClient({ timeoutMs: 20_000 });
const state: {
  locale: SupportedLocale;
  favorites: Location[];
  results: Location[];
  selected?: Location;
  forecast?: Forecast;
  query: string;
  status: string;
  error: boolean;
  busy?: BusyState;
  now: Date;
  chooserOpen: boolean;
} = {
  locale: "en-US",
  favorites: [],
  results: [],
  query: "",
  status: translationsForLocale("en-US").loading,
  error: false,
  busy: "initial",
  now: new Date(),
  chooserOpen: false,
};

let disposed = false;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let renderQueue = Promise.resolve();

bridge.onAction("search-location", (event) => void searchLocations(event));
bridge.onAction("preview-location", (event) => void previewLocation(event));
bridge.onAction("save-location", (event) => void saveLocation(event));
bridge.onAction("open-location", (event) => void openLocation(event));
bridge.onAction("remove-location", (event) => void removeLocation(event));
bridge.onAction("refresh-weather", () => void refreshWeather());
bridge.onAction("clear-search", () => void clearSearch());
bridge.onAction("toggle-location-chooser", () => void toggleLocationChooser());
bridge.onLifecycle((event) => {
  if (event.type !== "dispose") return;
  disposed = true;
  if (clockTimer !== undefined) clearInterval(clockTimer);
});

void initialize().catch(reportUnhandledFailure);

async function initialize(): Promise<void> {
  await bridge.ready();
  bridge.onContext((context) => {
    const locale = localeForLanguageTag(context.locale.language_tag);
    if (locale === state.locale) return;
    state.locale = locale;
    if (!state.error) state.status = state.forecast
      ? statusForForecast(state.forecast)
      : translations().ready;
    void render();
  });
  clockTimer = setInterval(() => {
    const next = new Date();
    if (next.getMinutes() === state.now.getMinutes() && next.getHours() === state.now.getHours()) return;
    state.now = next;
    void render();
  }, 15_000);
  await render();
  try {
    const response = await bridge.call<PluginMethodResult<StateLoad>>("weather.state.load", {});
    state.favorites = response.data.favorites;
    state.selected = response.data.selected ?? undefined;
    state.forecast = response.data.forecast ?? undefined;
    state.busy = undefined;
    if (response.data.selected) {
      state.status = state.forecast ? statusForForecast(state.forecast) : translations().loading;
      await render();
      void loadForecast(response.data.selected, { preserveVisible: true });
    } else {
      state.status = translations().ready;
      await render();
    }
  } catch (error) {
    state.busy = undefined;
    state.error = true;
    state.status = friendlyError(error, "load");
    await render();
  }
}

async function searchLocations(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const query = String(event.form_data?.query ?? "").trim();
  state.query = query;
  if ([...query].length < 2) {
    state.error = false;
    state.status = translations().searchHint;
    state.results = [];
    await render();
    return;
  }
  state.busy = "search";
  state.error = false;
  state.status = translations().searching;
  await render();
  try {
    const language = state.locale === "zh-CN" ? "zh" : "en";
    const response = await bridge.call<PluginMethodResult<LocationsResult>>(
      "weather.locations.search",
      { query, language },
    );
    state.results = response.data.locations;
    state.status = state.results.length === 0 ? translations().noResults : "";
  } catch (error) {
    state.results = [];
    state.error = true;
    state.status = friendlyError(error, "search");
  } finally {
    state.busy = undefined;
    await render();
  }
}

async function previewLocation(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const location = locationForAction(event);
  if (!location) return;
  state.chooserOpen = false;
  await loadForecast(location);
}

async function openLocation(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const location = state.favorites.find((item) => item.id === String(event.value ?? ""));
  if (!location) return;
  state.chooserOpen = false;
  await loadForecast(location);
}

async function refreshWeather(): Promise<void> {
  if (state.busy || !state.selected) return;
  await loadForecast(state.selected, { preserveVisible: true });
}

async function saveLocation(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const location = locationForAction(event);
  if (!location || isFavorite(location.id)) return;
  state.busy = "save";
  state.error = false;
  await render();
  try {
    const response = await bridge.call<PluginMethodResult<FavoritesResult>>(
      "weather.locations.save",
      location,
    );
    state.favorites = response.data.favorites;
    state.status = translations().saved;
  } catch (error) {
    state.error = true;
    state.status = friendlyError(error, "save");
  } finally {
    state.busy = undefined;
    await render();
  }
}

async function removeLocation(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const id = String(event.value ?? "");
  if (!isFavorite(id)) return;
  state.busy = "save";
  state.error = false;
  await render();
  try {
    const response = await bridge.call<PluginMethodResult<FavoritesResult>>(
      "weather.locations.remove",
      { id },
    );
    state.favorites = response.data.favorites;
    state.status = state.forecast ? statusForForecast(state.forecast) : translations().ready;
  } catch (error) {
    state.error = true;
    state.status = friendlyError(error, "save");
  } finally {
    state.busy = undefined;
    await render();
  }
}

async function clearSearch(): Promise<void> {
  state.query = "";
  state.results = [];
  state.error = false;
  state.status = state.forecast ? statusForForecast(state.forecast) : translations().ready;
  await render();
}

async function toggleLocationChooser(): Promise<void> {
  state.chooserOpen = !state.chooserOpen;
  if (!state.chooserOpen) {
    state.query = "";
    state.results = [];
    state.error = false;
    state.status = state.forecast ? statusForForecast(state.forecast) : translations().ready;
  }
  await render();
}

async function loadForecast(location: Location, options: { preserveVisible?: boolean } = {}): Promise<void> {
  if (state.busy) return;
  const preserveVisible = Boolean(options.preserveVisible && state.forecast && state.selected?.id === location.id);
  state.busy = "forecast";
  state.error = false;
  state.selected = location;
  if (!preserveVisible) state.forecast = undefined;
  state.status = preserveVisible ? translations().refreshing : translations().loading;
  await render();
  try {
    const response = await bridge.call<PluginMethodResult<ForecastResult>>(
      "weather.forecast",
      location,
    );
    state.selected = response.data.location;
    state.forecast = response.data.forecast;
    state.results = [];
    state.query = "";
    state.status = statusForForecast(response.data.forecast);
  } catch (error) {
    state.error = true;
    state.status = preserveVisible && state.forecast
      ? translations().refreshFailed
      : friendlyError(error, "forecast");
  } finally {
    state.busy = undefined;
    await render();
  }
}

function render(): Promise<void> {
  renderQueue = renderQueue
    .catch(() => undefined)
    .then(() => disposed ? undefined : bridge.render(view()));
  return renderQueue;
}

function view() {
  const t = translations();
  return (
    <main key="weather-root" className="weather-app">
      <header key="topbar" className="topbar">
        <div key="brand" className="brand">
          <span key="brand-mark" className="brand-mark" aria-hidden="true" />
          <h1 key="brand-title">{t.appName}</h1>
        </div>
        <button
          key="location-trigger"
          className="location-trigger"
          type="button"
          aria-expanded={state.chooserOpen}
          data-redevplugin-action="toggle-location-chooser"
        >
          <span key="location-trigger-label">{t.currentLocation}</span>
          <strong key="location-trigger-name">{state.selected?.name ?? t.chooseLocation}</strong>
          <span key="location-trigger-arrow" aria-hidden="true">⌄</span>
        </button>
      </header>

      {state.chooserOpen ? locationChooser(t) : null}

      <div key="status-row" className={state.error ? "status-row error" : "status-row"} role="status">
        <span key="status-dot" className="status-dot" aria-hidden="true" />
        <span key="status-copy">{state.status}</span>
      </div>

      {state.forecast && state.selected
        ? forecastDashboard(state.selected, state.forecast, t)
        : state.busy === "initial"
          ? loadingState(t)
          : emptyState(t)}

      <footer key="footer" className="footer">
        <span key="source">{t.poweredBy}</span>
        <span key="privacy">{t.secureBroker}</span>
      </footer>
    </main>
  );
}

function locationChooser(t: WeatherTranslations) {
  return (
    <section key="location-chooser" className="location-chooser" aria-label={t.chooseLocation}>
      <div key="chooser-heading" className="chooser-heading">
        <div key="chooser-title-copy">
          <span key="chooser-overline">{t.chooseLocation}</span>
          <strong key="chooser-title">{state.selected?.name ?? t.majorCities}</strong>
        </div>
        <button key="chooser-close" className="chooser-close" type="button" aria-label={t.closeLocationPicker} data-redevplugin-action="toggle-location-chooser">×</button>
      </div>
      <form key="search-form" className="search-form" data-redevplugin-action="search-location" autoComplete="off">
        <label key="search-label" className="sr-only" htmlFor="weather-query">{t.searchPlaceholder}</label>
        <input
          key="search-input"
          id="weather-query"
          name="query"
          type="search"
          value={state.query}
          placeholder={t.searchPlaceholder}
          maxLength={120}
          disabled={Boolean(state.busy)}
          autoComplete="off"
        />
        {state.query ? (
          <button key="clear-search" className="clear-button" type="button" title={t.remove} aria-label={t.remove} data-redevplugin-action="clear-search">×</button>
        ) : <span key="clear-search-placeholder" />}
        <button key="search-submit" className="primary-button" type="submit" disabled={Boolean(state.busy)}>
          {state.busy === "search" ? t.searching : t.search}
        </button>
      </form>
      {state.favorites.length > 0 ? favoritePlaces(t) : <span key="favorites-empty" />}
      {state.results.length > 0 ? searchResults(t) : majorCities(t)}
    </section>
  );
}

function majorCities(t: WeatherTranslations) {
  return (
    <section key="major-cities" className="major-cities" aria-label={t.majorCities}>
      <span key="major-cities-label" className="chooser-section-label">{t.majorCities}</span>
      <ul key="major-cities-list">
        {majorCitiesForLocale(state.locale).map((location) => (
          <li key={`major-${location.id}`}>
            <button key={`major-open-${location.id}`} type="button" value={location.id} disabled={Boolean(state.busy)} data-redevplugin-action="preview-location">
              <strong key={`major-name-${location.id}`}>{location.name}</strong>
              <span key={`major-country-${location.id}`}>{location.country}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function searchResults(t: WeatherTranslations) {
  return (
    <section key="search-results" className="search-results" aria-label={t.search}>
      <span key="search-results-label" className="chooser-section-label">{t.search}</span>
      <ul key="search-results-list">
        {state.results.map((location) => (
          <li key={`result-${location.id}`} className="search-result">
            <span key={`result-pin-${location.id}`} className="location-pin" aria-hidden="true">•</span>
            <div key={`result-copy-${location.id}`} className="location-copy">
              <strong key={`result-name-${location.id}`}>{location.name}</strong>
              <span key={`result-place-${location.id}`}>{locationSubtitle(location)}</span>
            </div>
            <div key={`result-actions-${location.id}`} className="result-actions">
              <button key={`result-view-${location.id}`} className="secondary-button" type="button" value={location.id} disabled={Boolean(state.busy)} data-redevplugin-action="preview-location">{t.view}</button>
              <button key={`result-save-${location.id}`} className="secondary-button" type="button" value={location.id} disabled={Boolean(state.busy) || isFavorite(location.id)} data-redevplugin-action="save-location">
                {isFavorite(location.id) ? t.saved : t.save}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function favoritePlaces(t: WeatherTranslations) {
  return (
    <nav key="favorites" className="favorites" aria-label={t.favorites}>
      <span key="favorites-label" className="favorites-label">{t.favorites}</span>
      <ul key="favorites-list">
        {state.favorites.map((location) => (
          <li key={`favorite-${location.id}`}>
            <button
              key={`favorite-open-${location.id}`}
              className="favorite-button"
              type="button"
              value={location.id}
              aria-pressed={state.selected?.id === location.id}
              disabled={Boolean(state.busy)}
              data-redevplugin-action="open-location"
            >{location.name}</button>
            <button
              key={`favorite-remove-${location.id}`}
              className="favorite-remove"
              type="button"
              value={location.id}
              title={`${t.remove} ${location.name}`}
              aria-label={`${t.remove} ${location.name}`}
              disabled={Boolean(state.busy)}
              data-redevplugin-action="remove-location"
            >×</button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function forecastDashboard(location: Location, forecast: Forecast, t: WeatherTranslations) {
  const current = forecast.current;
  const condition = conditionForCode(current.weather_code, current.is_day);
  return (
    <article key="forecast-dashboard" className={`forecast-dashboard condition-${condition.kind}`}>
      <section key="weather-hero" className="weather-hero">
        <div key="clock-column" className="clock-column">
          <div key="place-heading" className="place-heading">
            <div key="place-copy">
              <p key="place-overline" className="overline">{locationSubtitle(location)}</p>
              <h2 key="place-name">{location.name}</h2>
            </div>
            <div key="hero-actions" className="hero-actions">
              <button key="refresh" className="icon-button" type="button" title={t.refresh} aria-label={t.refresh} disabled={Boolean(state.busy)} data-redevplugin-action="refresh-weather">↻</button>
              <button key="save-selected" className="secondary-button" type="button" value={location.id} disabled={Boolean(state.busy) || isFavorite(location.id)} data-redevplugin-action="save-location">
                {isFavorite(location.id) ? t.saved : t.save}
              </button>
            </div>
          </div>
          <time key="local-time" className="local-time" dateTime={state.now.toISOString()}>{formatTime(state.now, location.timezone)}</time>
          <p key="local-date" className="local-date">{formatDate(state.now, location.timezone)}</p>
        </div>
        <div key="current-column" className="current-column">
          <span key="condition-symbol" className="condition-symbol" role="img" aria-label={translatedCondition(condition.kind)}>{condition.symbol}</span>
          <div key="temperature-copy" className="temperature-copy">
            <span key="current-temperature" className="current-temperature">{degrees(current.temperature)}</span>
            <span key="condition-label" className="condition-label">{translatedCondition(condition.kind)}</span>
          </div>
        </div>
      </section>

      <section key="metrics" className="metrics" aria-label={t.detailsLabel}>
        {metric("feels-like", t.feelsLike, degrees(current.apparent_temperature))}
        {metric("humidity", t.humidity, `${Math.round(current.humidity)}%`)}
        {metric("wind", t.wind, `${Math.round(current.wind_speed)} km/h`)}
        {metric("rain", t.precipitation, `${Math.round(forecast.days[0]?.precipitation_probability ?? 0)}%`)}
      </section>

      <section key="weekly-forecast" className="weekly-forecast" aria-label={t.forecastLabel}>
        <div key="forecast-heading" className="section-heading">
          <h3 key="forecast-title">{t.forecastTitle}</h3>
          <span key="forecast-zone">{forecast.timezone_abbreviation || forecast.timezone}</span>
        </div>
        <ol key="forecast-list" className="forecast-list">
          {forecast.days.map((day, index) => forecastRow(day, index, forecast, t))}
        </ol>
      </section>
    </article>
  );
}

function forecastRow(day: ForecastDay, index: number, forecast: Forecast, t: WeatherTranslations) {
  const condition = conditionForCode(day.weather_code, true);
  const range = temperatureRangeClasses(
    forecast.days,
    day,
    index === 0 ? forecast.current.temperature : undefined,
  );
  return (
    <li key={`day-${day.date}`} className={index === 0 ? "forecast-row today" : "forecast-row"}>
      <span key={`day-label-${day.date}`} className="day-label">{index === 0 ? t.today : formatForecastDay(day.date)}</span>
      <span key={`day-icon-${day.date}`} className="forecast-icon" role="img" aria-label={translatedCondition(condition.kind)}>{condition.symbol}</span>
      <span key={`day-rain-${day.date}`} className="rain-chance">{Math.round(day.precipitation_probability)}%</span>
      <span key={`day-low-${day.date}`} className="temperature-low" aria-label={`${t.low} ${degrees(day.temperature_min)}`}>{degrees(day.temperature_min)}</span>
      <span key={`day-track-${day.date}`} className="range-track" aria-hidden="true">
        <span key={`day-range-${day.date}`} className={`temperature-range ${range.startClass} ${range.widthClass}`} />
        {range.currentClass ? <span key={`day-current-${day.date}`} className={`current-dot ${range.currentClass}`} /> : <span key={`day-current-empty-${day.date}`} />}
      </span>
      <span key={`day-high-${day.date}`} className="temperature-high" aria-label={`${t.high} ${degrees(day.temperature_max)}`}>{degrees(day.temperature_max)}</span>
    </li>
  );
}

function metric(key: string, label: string, value: string) {
  return (
    <div key={`metric-${key}`} className="metric">
      <span key={`metric-label-${key}`}>{label}</span>
      <strong key={`metric-value-${key}`}>{value}</strong>
    </div>
  );
}

function loadingState(t: WeatherTranslations) {
  return (
    <section key="loading-state" className="empty-state" aria-label={t.loading}>
      <span key="loading-mark" className="loading-mark" aria-hidden="true" />
      <h2 key="loading-title">{t.loading}</h2>
    </section>
  );
}

function emptyState(t: WeatherTranslations) {
  return (
    <section key="empty-state" className="empty-state">
      <span key="empty-symbol" className="empty-symbol" aria-hidden="true">○</span>
      <h2 key="empty-title">{t.emptyTitle}</h2>
      <p key="empty-body">{t.emptyBody}</p>
    </section>
  );
}

function locationForAction(event: PluginUIActionEvent): Location | undefined {
  const id = String(event.value ?? "");
  return state.results.find((item) => item.id === id)
    ?? state.favorites.find((item) => item.id === id)
    ?? majorCitiesForLocale(state.locale).find((item) => item.id === id)
    ?? (state.selected?.id === id ? state.selected : undefined);
}

function isFavorite(id: string): boolean {
  return state.favorites.some((item) => item.id === id);
}

function translations(): WeatherTranslations {
  return translationsForLocale(state.locale);
}

function translatedCondition(kind: ReturnType<typeof conditionForCode>["kind"]): string {
  return translations().conditions[kind];
}

function locationSubtitle(location: Location): string {
  return [...new Set([location.admin1, location.country].filter(Boolean))].join(", ");
}

function statusForForecast(forecast: Forecast): string {
  return forecast.source === "saved" ? translations().savedForecast : translations().updated;
}

function friendlyError(error: unknown, operation: "load" | "search" | "save" | "forecast"): string {
  if (error instanceof PluginBridgeError && error.errorCode === "PLUGIN_PERMISSION_DENIED") {
    return translations().permission;
  }
  if (operation === "search") return translations().searchError;
  if (operation === "forecast") return translations().unavailable;
  return error instanceof Error && error.message ? error.message : translations().unavailable;
}

function formatTime(date: Date, timezone?: string): string {
  return safeDateFormat(date, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

function formatDate(date: Date, timezone?: string): string {
  return safeDateFormat(date, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

function formatForecastDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(state.locale, { weekday: "short" }).format(date);
}

function safeDateFormat(date: Date, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(state.locale, options).format(date);
  } catch {
    const { timeZone: _timeZone, ...fallback } = options;
    return new Intl.DateTimeFormat(state.locale, fallback).format(date);
  }
}

function degrees(value: number): string {
  return `${Math.round(value)}°`;
}

function reportUnhandledFailure(error: unknown): void {
  if (disposed && error instanceof PluginBridgeError && error.errorCode === "PLUGIN_BRIDGE_DISPOSED") return;
  queueMicrotask(() => { throw error; });
}
