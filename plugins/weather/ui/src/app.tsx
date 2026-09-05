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
type ForecastResult = { location: Location; forecast: Forecast; favorites: Location[] };
type BusyState = "initial" | "search" | "forecast" | "remove";
type Notice = { scope: "chooser" | "weather"; text: string; error?: boolean };

const bridge = new PluginBridgeClient({ timeoutMs: 20_000 });
const state: {
  locale: SupportedLocale;
  favorites: Location[];
  results: Location[];
  selected?: Location;
  pendingLocation?: Location;
  forecast?: Forecast;
  query: string;
  notice?: Notice;
  busy?: BusyState;
  now: Date;
  chooserOpen: boolean;
} = {
  locale: "en-US",
  favorites: [],
  results: [],
  query: "",
  busy: "initial",
  now: new Date(),
  chooserOpen: false,
};

let disposed = false;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let renderQueue = Promise.resolve();

bridge.onAction("search-location", (event) => void searchLocations(event));
bridge.onAction("preview-location", (event) => void previewLocation(event));
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
      await render();
      void loadForecast(response.data.selected, { preserveVisible: true });
    } else {
      await render();
    }
  } catch (error) {
    state.busy = undefined;
    state.notice = { scope: "chooser", text: friendlyError(error, "load"), error: true };
    await render();
  }
}

async function searchLocations(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const query = String(event.form_data?.query ?? "").trim();
  state.query = query;
  if ([...query].length < 2) {
    state.notice = { scope: "chooser", text: translations().searchHint };
    state.results = [];
    await render();
    return;
  }
  state.busy = "search";
  state.notice = undefined;
  await render();
  try {
    const language = state.locale === "zh-CN" ? "zh" : "en";
    const response = await bridge.call<PluginMethodResult<LocationsResult>>(
      "weather.locations.search",
      { query, language },
    );
    state.results = response.data.locations;
    state.notice = state.results.length === 0
      ? { scope: "chooser", text: translations().noResults }
      : undefined;
  } catch (error) {
    state.results = [];
    state.notice = { scope: "chooser", text: friendlyError(error, "search"), error: true };
  } finally {
    state.busy = undefined;
    await render();
  }
}

async function previewLocation(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const location = locationForAction(event);
  if (!location) return;
  await loadForecast(location);
}

async function openLocation(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const location = state.favorites.find((item) => item.id === String(event.value ?? ""));
  if (!location) return;
  await loadForecast(location);
}

async function refreshWeather(): Promise<void> {
  if (state.busy || !state.selected) return;
  await loadForecast(state.selected, { preserveVisible: true });
}

async function removeLocation(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const id = String(event.value ?? "");
  if (!isFavorite(id)) return;
  state.busy = "remove";
  state.notice = undefined;
  await render();
  try {
    const response = await bridge.call<PluginMethodResult<FavoritesResult>>(
      "weather.locations.remove",
      { id },
    );
    state.favorites = response.data.favorites;
  } catch (error) {
    state.notice = { scope: "chooser", text: friendlyError(error, "remove"), error: true };
  } finally {
    state.busy = undefined;
    await render();
  }
}

async function clearSearch(): Promise<void> {
  state.query = "";
  state.results = [];
  state.notice = undefined;
  await render();
}

async function toggleLocationChooser(): Promise<void> {
  state.chooserOpen = !state.chooserOpen;
  if (!state.chooserOpen) {
    state.query = "";
    state.results = [];
    state.notice = undefined;
  }
  await render();
}

async function loadForecast(location: Location, options: { preserveVisible?: boolean } = {}): Promise<void> {
  if (state.busy) return;
  const preserveVisible = Boolean(options.preserveVisible && state.forecast && state.selected?.id === location.id);
  state.busy = "forecast";
  state.notice = undefined;
  state.pendingLocation = options.preserveVisible ? undefined : location;
  await render();
  try {
    const response = await bridge.call<PluginMethodResult<ForecastResult>>(
      "weather.forecast",
      location,
    );
    state.selected = response.data.location;
    state.forecast = response.data.forecast;
    state.favorites = response.data.favorites;
    state.results = [];
    state.query = "";
    if (state.pendingLocation) state.chooserOpen = false;
  } catch (error) {
    const message = preserveVisible && state.forecast
      ? translations().refreshFailed
      : friendlyError(error, "forecast");
    state.notice = { scope: state.forecast && !state.chooserOpen ? "weather" : "chooser", text: message, error: true };
  } finally {
    state.busy = undefined;
    state.pendingLocation = undefined;
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
      {state.chooserOpen && state.forecast ? locationPicker(t, "popover") : null}

      {state.forecast && state.selected
        ? forecastDashboard(state.selected, state.forecast, t)
        : state.busy === "initial"
          ? loadingState(t)
          : locationPicker(t, "onboarding")}

      <footer key="footer" className="footer">
        <span key="source">{t.poweredBy}</span>
        <span key="privacy">{t.secureBroker}</span>
      </footer>
    </main>
  );
}

function locationPicker(t: WeatherTranslations, mode: "onboarding" | "popover") {
  const notice = state.notice?.scope === "chooser" ? state.notice : undefined;
  const status = notice?.text ?? (state.pendingLocation ? pendingLocationLabel(t) : state.busy === "forecast" ? t.loading : "");
  return (
    <section key={`location-${mode}`} className={`location-picker location-${mode}`} aria-label={t.chooseLocation}>
      {mode === "onboarding" ? onboardingIntroduction(t) : pickerHeading(t)}
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
      <p key="chooser-status" className={notice?.error ? "chooser-status error" : "chooser-status"} role="status">
        {state.busy === "forecast" ? <span key="chooser-loading" className="location-loading-mark" aria-hidden="true" /> : null}
        <span key="chooser-status-text">{status}</span>
      </p>
      {state.favorites.length > 0 ? favoritePlaces(t) : <span key="favorites-empty" />}
      {state.results.length > 0 ? searchResults(t) : majorCities(t)}
    </section>
  );
}

function onboardingIntroduction(t: WeatherTranslations) {
  return (
    <div key="onboarding-introduction" className="onboarding-introduction">
      <span key="onboarding-overline" className="chooser-overline">{t.chooseLocation}</span>
      <h2 key="onboarding-title">{t.onboardingTitle}</h2>
      <p key="onboarding-body">{t.onboardingBody}</p>
    </div>
  );
}

function pickerHeading(t: WeatherTranslations) {
  return (
    <div key="chooser-heading" className="chooser-heading">
      <div key="chooser-title-copy" className="chooser-title-copy">
        <span key="chooser-overline" className="chooser-overline">{t.chooseLocation}</span>
        <strong key="chooser-title">{state.selected?.name ?? t.majorCities}</strong>
      </div>
      <button key="chooser-close" className="chooser-close" type="button" aria-label={t.closeLocationPicker} data-redevplugin-action="toggle-location-chooser">×</button>
    </div>
  );
}

function majorCities(t: WeatherTranslations) {
  return (
    <section key="major-cities" className="major-cities" aria-label={t.majorCities}>
      <span key="major-cities-label" className="chooser-section-label">{t.majorCities}</span>
      <ul key="major-cities-list">
        {majorCitiesForLocale(state.locale).map((location) => (
          <li key={`major-${location.id}`}>
            <button key={`major-open-${location.id}`} type="button" value={location.id} disabled={Boolean(state.busy)} aria-busy={state.pendingLocation?.id === location.id} data-redevplugin-action="preview-location">
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
            <button key={`result-open-${location.id}`} className="search-result-button" type="button" value={location.id} disabled={Boolean(state.busy)} aria-busy={state.pendingLocation?.id === location.id} data-redevplugin-action="preview-location">
              <span key={`result-pin-${location.id}`} className="location-pin" aria-hidden="true">•</span>
              <span key={`result-copy-${location.id}`} className="location-copy">
                <strong key={`result-name-${location.id}`}>{location.name}</strong>
                <span key={`result-place-${location.id}`}>{locationSubtitle(location)}</span>
              </span>
              <span key={`result-arrow-${location.id}`} className="result-arrow" aria-hidden="true">→</span>
            </button>
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
              aria-busy={state.pendingLocation?.id === location.id}
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
  const notice = state.notice?.scope === "weather" ? state.notice : undefined;
  const showProgress = Boolean(state.pendingLocation && !state.chooserOpen);
  return (
    <article key="forecast-dashboard" className={`forecast-dashboard condition-${condition.kind}${showProgress ? " has-progress" : ""}`}>
      {showProgress ? (
        <p key="weather-progress" className="weather-progress" role="status">
          <span key="weather-progress-mark" className="location-loading-mark" aria-hidden="true" />
          <span key="weather-progress-text">{pendingLocationLabel(t)}</span>
        </p>
      ) : null}
      <section key="weather-hero" className="weather-hero">
        {weatherCardControls(t)}
        <div key="clock-column" className="clock-column">
          <div key="place-heading" className="place-heading">
            <div key="place-copy">
              <p key="place-overline" className="overline">{locationSubtitle(location)}</p>
              <h2 key="place-name">{location.name}</h2>
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
        {notice ? (
          <p key="weather-alert" className="weather-alert" role={notice.error ? "alert" : "status"}>{notice.text}</p>
        ) : null}
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
    <section key="loading-state" className="loading-state" aria-label={t.loading}>
      <span key="loading-mark" className="loading-mark" aria-hidden="true" />
      <h2 key="loading-title">{t.loading}</h2>
    </section>
  );
}

function weatherCardControls(t: WeatherTranslations) {
  const refreshing = state.busy === "forecast" && Boolean(state.forecast) && !state.pendingLocation;
  const refreshLabel = refreshing ? t.refreshing : t.refresh;
  return (
    <div key="weather-card-controls" className="weather-card-controls">
      <button
        key="location-trigger"
        className="location-trigger"
        type="button"
        title={t.chooseLocation}
        aria-label={`${t.chooseLocation}: ${state.selected?.name ?? t.chooseLocation}`}
        aria-expanded={state.chooserOpen}
        data-redevplugin-action="toggle-location-chooser"
      >
        <strong key="location-trigger-name" className="location-trigger-name">{state.selected?.name ?? t.chooseLocation}</strong>
        <span key="location-trigger-arrow" className="location-trigger-arrow" aria-hidden="true">⌄</span>
      </button>
      {state.selected ? (
        <button
          key="refresh"
          className={refreshing ? "icon-button weather-card-refresh is-refreshing" : "icon-button weather-card-refresh"}
          type="button"
          title={refreshLabel}
          aria-label={refreshLabel}
          aria-busy={refreshing}
          disabled={Boolean(state.busy)}
          data-redevplugin-action="refresh-weather"
        >
          <span key="refresh-icon" className="refresh-icon" aria-hidden="true">↻</span>
        </button>
      ) : null}
    </div>
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

function pendingLocationLabel(t: WeatherTranslations): string {
  return t.loadingLocation.replace("{city}", state.pendingLocation?.name ?? "");
}

function translatedCondition(kind: ReturnType<typeof conditionForCode>["kind"]): string {
  return translations().conditions[kind];
}

function locationSubtitle(location: Location): string {
  return [...new Set([location.admin1, location.country].filter(Boolean))].join(", ");
}

function friendlyError(error: unknown, operation: "load" | "search" | "remove" | "forecast"): string {
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
