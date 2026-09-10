import { drawWeatherChart } from "./weather-chart.js";
import {
  PluginBridgeClient,
  PluginBridgeError,
  type PluginMethodResult,
  type PluginUIActionEvent,
  type PluginCanvasSurface,
} from "@floegence/redevplugin-ui/plugin";
import {
  conditionForCode,
  formatMessage,
  formatCivilDate,
  localizedLocation,
  type WeatherMessageKey,
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
const state: {
  locale: SupportedLocale;
  favorites: Location[];
  results: Location[];
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
} = {
  locale: "en-US",
  favorites: [],
  results: [],
  query: "",
  busy: "initial",
  now: new Date(),
  chooserOpen: false,
  sidebarCollapsed: false,
  detailDay: 0,
  apparent: false,
  cityForecasts: {},
};

let chartSurface: PluginCanvasSurface | undefined;
let chartReady = false;
let stopChartInput: (() => void) | undefined;
let disposed = false;

function resetChart() {
  chartSurface = undefined;
  chartReady = false;
  stopChartInput?.();
  stopChartInput = undefined;
}
let clockTimer: ReturnType<typeof setInterval> | undefined;
let renderQueue = Promise.resolve();

bridge.onAction("search-location", (event) => void searchLocations(event));
bridge.onAction("preview-location", (event) => void previewLocation(event));
bridge.onAction("open-location", (event) => void openLocation(event));
bridge.onAction("remove-location", (event) => void removeLocation(event));
bridge.onAction("refresh-weather", () => void refreshWeather());
bridge.onAction("clear-search", () => void clearSearch());
bridge.onAction("toggle-location-chooser", () => void toggleLocationChooser());
bridge.onAction("toggle-sidebar", () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  void render();
});
bridge.onAction("open-detail", (event) => {
  if (!metricItems().some((item) => item.id === event.value)) return;
  state.detail = String(event.value);
  state.detailDay = 0;
  void render();
});
bridge.onAction("open-day", (event) => {
  const day = Number(event.value);
  if (!Number.isInteger(day) || !state.forecast?.days[day]) return;
  state.detail = "temperature";
  state.detailDay = day;
  void render();
});
bridge.onAction("detail-day", (event) => {
  const day = Number(event.value);
  if (!Number.isInteger(day) || !state.forecast?.days[day]) return;
  state.detailDay = day;
  void render();
});
bridge.onAction("detail-temperature", (event) => {
  state.apparent = event.value === "apparent";
  void render();
});
bridge.onAction("close-detail", () => {
  state.detail = undefined;
  void render();
});
bridge.onLifecycle((event) => {
  if (event.type !== "dispose") return;
  disposed = true;
  resetChart();
  if (clockTimer !== undefined) clearInterval(clockTimer);
});

void initialize().catch(reportUnhandledFailure);

async function initialize(): Promise<void> {
  await bridge.ready();
  bridge.onContext((context) => {
    const locale = localeForLanguageTag(context.locale.language_tag);
    if (locale === state.locale) return;
    state.locale = locale;
    state.results = [];
    void render();
  });
  clockTimer = setInterval(() => {
    const next = new Date();
    if (
      next.getMinutes() === state.now.getMinutes() &&
      next.getHours() === state.now.getHours()
    )
      return;
    state.now = next;
    void render();
  }, 15_000);
  await render();
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
      await render();
      void loadForecast(response.data.selected, { preserveVisible: true });
    } else {
      await render();
    }
  } catch (error) {
    state.busy = undefined;
    state.notice = {
      scope: "chooser",
      text: friendlyError(error, "load"),
      error: true,
    };
    await render();
  }
}

async function searchLocations(event: PluginUIActionEvent): Promise<void> {
  if (state.busy) return;
  const query = String(event.form_data?.query ?? "").trim();
  state.query = query;
  if ([...query].length < 2) {
    state.notice = { scope: "chooser", text: "searchHint" };
    state.results = [];
    await render();
    return;
  }
  state.busy = "search";
  state.notice = undefined;
  await render();
  try {
    const searchLocale = state.locale;
    const language = searchLocale.split("-")[0];
    const response = await bridge.call<PluginMethodResult<LocationsResult>>(
      "weather.locations.search",
      { query, language },
    );
    if (state.locale !== searchLocale) return;
    state.results = response.data.locations;
    state.notice =
      state.results.length === 0
        ? { scope: "chooser", text: "noResults" }
        : undefined;
  } catch (error) {
    state.results = [];
    state.notice = {
      scope: "chooser",
      text: friendlyError(error, "search"),
      error: true,
    };
  } finally {
    state.busy = undefined;
    await render();
  }
}

async function previewLocation(event: PluginUIActionEvent): Promise<void> {
  const location = locationForAction(event);
  if (!location) return;
  await loadForecast(location);
}

async function openLocation(event: PluginUIActionEvent): Promise<void> {
  const location = state.favorites.find(
    (item) => item.id === String(event.value ?? ""),
  );
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
    state.notice = {
      scope: "chooser",
      text: friendlyError(error, "remove"),
      error: true,
    };
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

async function loadForecast(
  location: Location,
  options: { preserveVisible?: boolean } = {},
): Promise<void> {
  if (state.busy === "forecast") {
    state.queuedLocation = location;
    state.pendingLocation = location;
    state.notice = undefined;
    await render();
    return;
  }
  if (state.busy) return;
  const preserveVisible = Boolean(
    options.preserveVisible &&
      state.forecast &&
      state.selected?.id === location.id,
  );
  state.busy = "forecast";
  state.notice = undefined;
  state.pendingLocation = options.preserveVisible ? undefined : location;
  await render();
  try {
    const response = await bridge.call<PluginMethodResult<ForecastResult>>(
      "weather.forecast",
      location,
    );
    if (state.queuedLocation) return;
    state.selected = response.data.location;
    state.forecast = response.data.forecast;
    state.cityForecasts[response.data.location.id] = response.data.forecast;
    state.detail = undefined;
    state.favorites = response.data.favorites;
    state.results = [];
    state.query = "";
    if (state.pendingLocation) state.chooserOpen = false;
  } catch (error) {
    if (state.queuedLocation) return;
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
    if (queuedLocation) await loadForecast(queuedLocation);
    else await render();
  }
}

function render(): Promise<void> {
  renderQueue = renderQueue
    .catch(() => undefined)
    .then(async () => {
      if (disposed) return;
      await bridge.render(view());
      await renderDetailChart();
    });
  return renderQueue;
}

function view() {
  const t = translations();
  return (
    <main
      key="weather-root"
      lang={state.locale}
      className={`weather-app sky-${conditionForCode(state.forecast?.current.weather_code ?? 3, state.forecast?.current.is_day ?? true).kind}${state.sidebarCollapsed ? " sidebar-collapsed" : ""}${state.forecast?.current.is_day === false ? " weather-night" : ""}`}
    >
      <div key="sky" className="weather-sky" aria-hidden="true">
        <span key="cloud-one" className="cloud cloud-one" />
        <span key="cloud-two" className="cloud cloud-two" />
        <span key="precipitation" className="sky-precipitation" />
      </div>
      {state.forecast ? citySidebar(t) : null}
      <div
        key="weather-content"
        className="weather-content"
        aria-hidden={state.detail ? true : undefined}
      >
        {state.chooserOpen && state.forecast
          ? locationPicker(t, "popover")
          : null}

        {state.forecast && state.selected
          ? forecastDashboard(state.selected, state.forecast, t)
          : state.busy === "initial"
            ? loadingState(t)
            : locationPicker(t, "onboarding")}

        <footer key="footer" className="footer">
          <span key="source">{t.poweredBy}</span>
          <span key="observation">
            {state.forecast
              ? `${state.forecast.source === "saved" ? message("savedWeather") + " · " : ""}${state.forecast.current.time.replace("T", " ")} · ${state.forecast.timezone}`
              : ""}
          </span>
        </footer>
      </div>
      {weatherDetail(t)}
    </main>
  );
}

function locationPicker(
  t: WeatherTranslations,
  mode: "onboarding" | "popover",
) {
  const notice = state.notice?.scope === "chooser" ? state.notice : undefined;
  const status =
    (notice ? message(notice.text) : undefined) ??
    (state.pendingLocation
      ? pendingLocationLabel(t)
      : state.busy === "forecast"
        ? t.loading
        : "");
  return (
    <section
      key={`location-${mode}`}
      className={`location-picker location-${mode}`}
      aria-label={t.chooseLocation}
      data-redevplugin-escape-action={
        mode === "popover" ? "toggle-location-chooser" : undefined
      }
    >
      {mode === "onboarding" ? onboardingIntroduction(t) : pickerHeading(t)}
      <form
        key="search-form"
        className="search-form"
        data-redevplugin-action="search-location"
        autoComplete="off"
      >
        <label key="search-label" className="sr-only" htmlFor="weather-query">
          {t.searchPlaceholder}
        </label>
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
          <button
            key="clear-search"
            className="clear-button"
            type="button"
            title={t.remove}
            aria-label={t.remove}
            data-redevplugin-action="clear-search"
          >
            ×
          </button>
        ) : (
          <span key="clear-search-placeholder" />
        )}
        <button
          key="search-submit"
          className="primary-button"
          type="submit"
          disabled={Boolean(state.busy)}
        >
          {state.busy === "search" ? t.searching : t.search}
        </button>
      </form>
      <p
        key="chooser-status"
        className={notice?.error ? "chooser-status error" : "chooser-status"}
        role="status"
      >
        {state.busy === "forecast" ? (
          <span
            key="chooser-loading"
            className="location-loading-mark"
            aria-hidden="true"
          />
        ) : null}
        <span key="chooser-status-text">{status}</span>
      </p>
      {state.favorites.length > 0 ? (
        favoritePlaces(t)
      ) : (
        <span key="favorites-empty" />
      )}
      {state.results.length > 0 ? searchResults(t) : majorCities(t)}
    </section>
  );
}

function onboardingIntroduction(t: WeatherTranslations) {
  return (
    <div key="onboarding-introduction" className="onboarding-introduction">
      <span key="onboarding-overline" className="chooser-overline">
        {t.chooseLocation}
      </span>
      <h2 key="onboarding-title">{t.onboardingTitle}</h2>
      <p key="onboarding-body">{t.onboardingBody}</p>
    </div>
  );
}

function pickerHeading(t: WeatherTranslations) {
  return (
    <div key="chooser-heading" className="chooser-heading">
      <div key="chooser-title-copy" className="chooser-title-copy">
        <span key="chooser-overline" className="chooser-overline">
          {t.chooseLocation}
        </span>
        <strong key="chooser-title">
          {(state.selected
            ? localizedLocation(state.selected, state.locale).name
            : undefined) ?? t.majorCities}
        </strong>
      </div>
      <button
        key="chooser-close"
        className="chooser-close"
        type="button"
        aria-label={t.closeLocationPicker}
        data-redevplugin-action="toggle-location-chooser"
      >
        ×
      </button>
    </div>
  );
}

function majorCities(t: WeatherTranslations) {
  return (
    <section
      key="major-cities"
      className="major-cities"
      aria-label={t.majorCities}
    >
      <span key="major-cities-label" className="chooser-section-label">
        {t.majorCities}
      </span>
      <ul key="major-cities-list">
        {majorCitiesForLocale(state.locale).map((location) => (
          <li key={`major-${location.id}`}>
            <button
              key={`major-open-${location.id}`}
              type="button"
              value={location.id}
              disabled={Boolean(state.busy && state.busy !== "forecast")}
              aria-busy={state.pendingLocation?.id === location.id}
              data-redevplugin-action="preview-location"
            >
              <strong key={`major-name-${location.id}`}>
                {localizedLocation(location, state.locale).name}
              </strong>
              <span key={`major-country-${location.id}`}>
                {location.country}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function searchResults(t: WeatherTranslations) {
  return (
    <section
      key="search-results"
      className="search-results"
      aria-label={t.search}
    >
      <span key="search-results-label" className="chooser-section-label">
        {t.search}
      </span>
      <ul key="search-results-list">
        {state.results.map((location) => (
          <li key={`result-${location.id}`} className="search-result">
            <button
              key={`result-open-${location.id}`}
              className="search-result-button"
              type="button"
              value={location.id}
              disabled={Boolean(state.busy && state.busy !== "forecast")}
              aria-busy={state.pendingLocation?.id === location.id}
              data-redevplugin-action="preview-location"
            >
              <span
                key={`result-pin-${location.id}`}
                className="location-pin"
                aria-hidden="true"
              >
                •
              </span>
              <span
                key={`result-copy-${location.id}`}
                className="location-copy"
              >
                <strong key={`result-name-${location.id}`}>
                  {localizedLocation(location, state.locale).name}
                </strong>
                <span key={`result-place-${location.id}`}>
                  {locationSubtitle(location)}
                </span>
              </span>
              <span
                key={`result-arrow-${location.id}`}
                className="result-arrow"
                aria-hidden="true"
              >
                →
              </span>
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
      <span key="favorites-label" className="favorites-label">
        {t.favorites}
      </span>
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
              disabled={Boolean(state.busy && state.busy !== "forecast")}
              data-redevplugin-action="open-location"
            >
              {localizedLocation(location, state.locale).name}
            </button>
            <button
              key={`favorite-remove-${location.id}`}
              className="favorite-remove"
              type="button"
              value={location.id}
              title={`${t.remove} ${localizedLocation(location, state.locale).name}`}
              aria-label={`${t.remove} ${localizedLocation(location, state.locale).name}`}
              disabled={Boolean(state.busy)}
              data-redevplugin-action="remove-location"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function message(
  key: WeatherMessageKey,
  values: Record<string, string | number> = {},
): string {
  return formatMessage(state.locale, key, values);
}

function weatherIcon(code: number, day = true, key = "icon") {
  const condition = conditionForCode(code, day);
  return (
    <span
      key={key}
      className={`weather-icon icon-${condition.kind}`}
      role="img"
      aria-label={translatedCondition(condition.kind)}
    >
      <span key={`${key}-sun`} className="icon-sun" />
      <span key={`${key}-cloud`} className="icon-cloud" />
      <span key={`${key}-drops`} className="icon-drops" />
    </span>
  );
}

function citySidebar(t: WeatherTranslations) {
  return (
    <aside
      key="city-sidebar"
      className="city-sidebar"
      aria-label={t.favorites}
      aria-hidden={state.detail ? true : undefined}
    >
      <div key="sidebar-toolbar" className="sidebar-toolbar">
        <span key="sidebar-title">{message("weather")}</span>
        <button
          key="sidebar-close"
          type="button"
          className="plain-button"
          aria-label={message("hideSidebar")}
          data-redevplugin-action="toggle-sidebar"
        >
          ◧
        </button>
      </div>
      <button
        key="sidebar-search"
        type="button"
        className="sidebar-search"
        data-redevplugin-action="toggle-location-chooser"
      >
        ⌕　{t.searchPlaceholder}
      </button>
      <nav key="city-list" className="city-list">
        {state.favorites.map((location) => {
          const forecast = state.cityForecasts[location.id];
          return (
            <button
              key={`sidebar-${location.id}`}
              type="button"
              value={location.id}
              title={
                forecast
                  ? `${message("observed")} ${forecast.current.time.replace("T", " ")}`
                  : undefined
              }
              className={`city-card sky-${conditionForCode(forecast?.current.weather_code ?? 3, forecast?.current.is_day ?? true).kind}${forecast?.current.is_day === false ? " weather-night" : ""}`}
              aria-pressed={state.selected?.id === location.id}
              aria-busy={state.pendingLocation?.id === location.id}
              data-redevplugin-action="open-location"
            >
              <strong key={`city-name-${location.id}`}>
                {localizedLocation(location, state.locale).name}
              </strong>
              <time key={`city-time-${location.id}`}>
                {formatTime(state.now, location.timezone)}
              </time>
              <span
                key={`city-temperature-${location.id}`}
                className="city-temperature"
              >
                {forecast ? degrees(forecast.current.temperature) : "—"}
              </span>
              <span
                key={`city-condition-${location.id}`}
                className="city-condition"
              >
                {forecast
                  ? translatedCondition(
                      conditionForCode(
                        forecast.current.weather_code,
                        forecast.current.is_day,
                      ).kind,
                    )
                  : location.country}
              </span>
              <span key={`city-range-${location.id}`} className="city-range">
                {forecast?.days[0]
                  ? `${t.high} ${degrees(forecast.days[0].temperature_max)} ${t.low} ${degrees(forecast.days[0].temperature_min)}`
                  : ""}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function upcomingHours(forecast: Forecast) {
  // Provider timestamps are local wall times in the forecast timezone, not browser time.
  return (forecast.hourly ?? [])
    .filter((hour) => hour.time >= forecast.current.time.slice(0, 13) + ":00")
    .slice(0, 24);
}

function forecastDashboard(
  location: Location,
  forecast: Forecast,
  t: WeatherTranslations,
) {
  const current = forecast.current;
  const notice = state.notice?.scope === "weather" ? state.notice : undefined;
  const hours = upcomingHours(forecast);
  return (
    <article key="forecast-dashboard" className="forecast-dashboard">
      {weatherCardControls(t)}
      {state.pendingLocation && !state.chooserOpen ? (
        <p key="weather-progress" className="weather-progress" role="status">
          <span key="progress-mark" className="location-loading-mark" />
          {pendingLocationLabel(t)}
        </p>
      ) : null}
      <header key={`weather-hero-${location.id}`} className="weather-hero">
        <h2 key="place-name">
          {localizedLocation(location, state.locale).name}
        </h2>
        <span key="current-temperature" className="current-temperature">
          {degrees(current.temperature)}
        </span>
        <p key="hero-range" className="hero-range">
          {forecast.days[0] ? (
            <span key="hero-range-values">
              <span key="hero-high-label" className="range-label">
                {t.high}
              </span>{" "}
              {degrees(forecast.days[0].temperature_max)}{" "}
              <span key="hero-low-label" className="range-label">
                {t.low}
              </span>{" "}
              {degrees(forecast.days[0].temperature_min)}
            </span>
          ) : (
            ""
          )}
        </p>
        <p key="condition-label" className="condition-label">
          {translatedCondition(
            conditionForCode(current.weather_code, current.is_day).kind,
          )}
        </p>
      </header>
      {notice ? (
        <p
          key="weather-alert"
          className="weather-alert"
          role={notice.error ? "alert" : "status"}
        >
          {message(notice.text)}
        </p>
      ) : null}
      <div key="weather-grid" className="weather-grid">
        {hours.length ? (
          <section
            key="hourly"
            className="glass-card hourly-card"
            aria-label={message("hourly")}
          >
            <h3 key="hourly-title">◷ {message("hourly")}</h3>
            <ol key="hourly-list" className="hourly-list">
              {hours.map((hour, index) => (
                <li key={`hour-${hour.time}`}>
                  <button
                    key={`hour-button-${hour.time}`}
                    type="button"
                    value={String(
                      forecast.days.findIndex((day) =>
                        hour.time.startsWith(day.date),
                      ),
                    )}
                    data-redevplugin-action="open-day"
                  >
                    <span key={`hour-label-${hour.time}`}>
                      {index === 0 ? message("now") : hour.time.slice(11, 16)}
                    </span>
                    {weatherIcon(
                      index === 0 ? current.weather_code : hour.weather_code,
                      index === 0 ? current.is_day : hour.is_day,
                      `hour-icon-${hour.time}`,
                    )}
                    <strong key={`hour-temperature-${hour.time}`}>
                      {degrees(
                        index === 0 ? current.temperature : hour.temperature,
                      )}
                    </strong>
                    {hour.precipitation_probability >= 20 ? (
                      <small key={`hour-rain-${hour.time}`}>
                        {Math.round(hour.precipitation_probability)}%
                      </small>
                    ) : null}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <section
          key="weekly-forecast"
          className="glass-card weekly-forecast"
          aria-label={t.forecastLabel}
        >
          <h3 key="forecast-title">
            ▦{" "}
            {forecast.days.length === 10
              ? t.forecastTitle
              : message("daysForecast", { count: forecast.days.length })}
          </h3>
          <ol key="forecast-list" className="forecast-list">
            {forecast.days.map((day, index) =>
              forecastRow(day, index, forecast, t),
            )}
          </ol>
        </section>
        {metricItems().map((item) => (
          <button
            key={`metric-${item.id}`}
            type="button"
            className={`glass-card metric metric-${item.id}`}
            value={item.id}
            data-redevplugin-action="open-detail"
            aria-label={`${item.label}: ${item.value}`}
          >
            <span key={`metric-label-${item.id}`} className="card-label">
              {item.symbol} {item.label}
            </span>
            <strong key={`metric-value-${item.id}`} className="metric-value">
              {item.value}
            </strong>
            {metricIllustration(item.id)}
            <span key={`metric-note-${item.id}`} className="metric-note">
              {item.note}
            </span>
          </button>
        ))}
      </div>
    </article>
  );
}

function forecastRow(
  day: ForecastDay,
  index: number,
  forecast: Forecast,
  t: WeatherTranslations,
) {
  const range = temperatureRangeClasses(
    forecast.days,
    day,
    index === 0 ? forecast.current.temperature : undefined,
  );
  return (
    <li key={`day-${day.date}`}>
      <button
        key={`day-button-${day.date}`}
        type="button"
        className="forecast-row"
        value={String(index)}
        data-redevplugin-action="open-day"
      >
        <span key={`day-label-${day.date}`} className="day-label">
          {index === 0 ? t.today : formatForecastDay(day.date)}
        </span>
        <span key={`day-condition-${day.date}`} className="day-condition">
          {weatherIcon(day.weather_code, true, `day-icon-${day.date}`)}
          {day.precipitation_probability >= 20 ? (
            <small key={`day-rain-${day.date}`}>
              {Math.round(day.precipitation_probability)}%
            </small>
          ) : null}
        </span>
        <span key={`day-low-${day.date}`} className="temperature-low">
          {degrees(day.temperature_min)}
        </span>
        <span
          key={`day-track-${day.date}`}
          className="range-track"
          aria-hidden="true"
        >
          <span
            key={`day-range-${day.date}`}
            className={`temperature-range ${range.startClass} ${range.widthClass}`}
          />
          {range.currentClass ? (
            <span
              key={`day-current-${day.date}`}
              className={`current-dot ${range.currentClass}`}
            />
          ) : null}
        </span>
        <span key={`day-high-${day.date}`} className="temperature-high">
          {degrees(day.temperature_max)}
        </span>
      </button>
    </li>
  );
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
      value: `${Math.round(hour.pressure)}`,
      note: message("seaLevel"),
    });
  return result;
}

function metricIllustration(id: string, context = "card") {
  const hour = state.forecast ? upcomingHours(state.forecast)[0] : undefined;
  if (id === "wind" && hour?.wind_direction != null)
    return (
      <span
        key={`${context}-compass`}
        className={`compass direction-${Math.round(hour.wind_direction / 10) % 36}`}
        aria-hidden="true"
      >
        <span key={`${context}-north`} className="north">
          {message("north")}
        </span>
        <span key={`${context}-west`} className="west">
          {message("west")}
        </span>
        <span key={`${context}-east`} className="east">
          {message("east")}
        </span>
        <span key={`${context}-south`} className="south">
          {message("south")}
        </span>
        <span key={`${context}-needle`} className="compass-needle" />
      </span>
    );
  if (id === "sunset")
    return (
      <span key={`${context}-sun-path`} className="sun-path" aria-hidden="true">
        <span key={`${context}-sun-arc`} />
      </span>
    );
  if (id === "uv" && hour?.uv_index != null)
    return (
      <span
        key={`${context}-uv-scale`}
        className={`uv-scale level-${Math.min(10, Math.round(hour.uv_index))}`}
        aria-hidden="true"
      />
    );
  if (id === "humidity")
    return (
      <span
        key={`${context}-humidity-scale`}
        className={`humidity-scale level-${Math.round((state.forecast?.current.humidity ?? 0) / 10)}`}
        aria-hidden="true"
      />
    );
  if (id === "pressure")
    return (
      <span
        key={`${context}-pressure-dial`}
        className="pressure-dial"
        aria-hidden="true"
      />
    );
  return null;
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

async function renderDetailChart() {
  if (
    !state.detail ||
    state.detail === "sunset" ||
    !detailChartData().samples.length
  )
    return;
  if (!chartSurface) {
    try {
      const surface = await bridge.openCanvas("weather-chart");
      if (disposed) return;
      chartSurface = surface;
      stopChartInput = bridge.onCanvasInput(surface.canvasId, (event) => {
        if (event.type !== "resize" || !chartSurface) return;
        chartSurface = {
          ...chartSurface,
          cssWidth: event.cssWidth,
          cssHeight: event.cssHeight,
          devicePixelRatio: event.devicePixelRatio,
        };
        drawDetailChart();
      });
      chartReady = Boolean(surface.canvas.getContext("2d"));
      if (chartReady) await bridge.render(view());
    } catch {
      // Keep the accessible CSS plot if the optional canvas cannot be allocated.
      return;
    }
  }
  drawDetailChart();
}

function drawDetailChart() {
  const surface = chartSurface;
  if (!surface || !state.detail) return;
  const context = surface.canvas.getContext("2d");
  if (!context) return;
  surface.canvas.width = Math.round(
    surface.cssWidth * surface.devicePixelRatio,
  );
  surface.canvas.height = Math.round(
    surface.cssHeight * surface.devicePixelRatio,
  );
  context.setTransform(
    surface.devicePixelRatio,
    0,
    0,
    surface.devicePixelRatio,
    0,
    0,
  );
  const { samples, minimum, maximum } = detailChartData();
  drawWeatherChart(
    context,
    samples,
    surface.cssWidth,
    surface.cssHeight,
    minimum,
    maximum,
  );
}

function weatherDetail(t: WeatherTranslations) {
  const forecast = state.forecast;
  if (!forecast) return null;
  const metric = metricItems().find((item) => item.id === state.detail);
  const day = forecast.days[state.detailDay];
  const {
    samples: hours,
    values,
    minimum: min,
    maximum: max,
  } = detailChartData();
  const title = metric?.label ?? message("conditionsTitle");
  const unit =
    state.detail === "temperature" || state.detail === "feels-like"
      ? "°"
      : state.detail === "humidity" || state.detail === "rain"
        ? "%"
        : state.detail === "wind"
          ? ` ${message("windUnit")}`
          : state.detail === "visibility"
            ? ` ${message("kilometers")}`
            : state.detail === "pressure"
              ? " hPa"
              : "";
  return (
    <section key="detail-layer" className="detail-layer" hidden={!state.detail}>
      <div
        key="detail-backdrop"
        className="detail-backdrop"
        aria-hidden="true"
        data-redevplugin-action="close-detail"
      />
      <section
        key="weather-detail"
        className="weather-detail"
        role="dialog"
        aria-modal={state.detail ? true : undefined}
        aria-label={title}
        data-redevplugin-escape-action="close-detail"
      >
        <header key="detail-heading" className="detail-heading">
          <h2 key="detail-title">{title}</h2>
          <button
            key="detail-close"
            type="button"
            className="plain-button"
            autoFocus={Boolean(state.detail)}
            aria-label={message("closeDetails")}
            data-redevplugin-action="close-detail"
          >
            ×
          </button>
        </header>
        {state.detail !== "sunset" && day ? (
          <nav
            key="detail-days"
            className="detail-days"
            aria-label={t.forecastLabel}
          >
            {forecast.days.map((item, index) => (
              <button
                key={`detail-date-${item.date}`}
                type="button"
                value={String(index)}
                aria-pressed={index === state.detailDay}
                data-redevplugin-action="detail-day"
              >
                <span key={`detail-weekday-${item.date}`}>
                  {formatForecastDay(item.date)}
                </span>
                <strong key={`detail-number-${item.date}`}>
                  {Number(item.date.slice(8))}
                </strong>
              </button>
            ))}
          </nav>
        ) : null}
        <p key="detail-date" className="detail-date">
          {day ? formatCivilDate(day.date, state.locale) : ""}
        </p>
        <div key="detail-summary" className="detail-summary">
          <strong key="detail-value">
            {state.detail === "temperature" && state.detailDay === 0
              ? degrees(
                  state.apparent
                    ? forecast.current.apparent_temperature
                    : forecast.current.temperature,
                )
              : state.detailDay === 0 && metric
                ? metric.value
                : metric && values.length
                  ? `${Math.round(Math.min(...values))}–${Math.round(Math.max(...values))}${unit}`
                  : day
                    ? `${degrees(day.temperature_max)} / ${degrees(day.temperature_min)}`
                    : "—"}
          </strong>
          <p key="detail-summary-note">
            {state.detailDay === 0 && metric
              ? metric.note
              : metric
                ? message("dailyRange")
                : day
                  ? translatedCondition(
                      conditionForCode(day.weather_code, true).kind,
                    )
                  : ""}
          </p>
        </div>
        {state.detail === "sunset" ? (
          <div key="sun-detail" className="sun-detail">
            {metricIllustration("sunset", "detail")}
            <p key="sun-caption">{metric?.note}</p>
          </div>
        ) : null}
        <div
          key="hourly-chart"
          hidden={state.detail === "sunset" || !values.length}
          className={chartReady ? "hourly-chart has-canvas" : "hourly-chart"}
          role="group"
          aria-label={`${title} · ${day?.date}`}
        >
          <canvas
            key="weather-chart"
            className="chart-canvas"
            data-redevplugin-canvas="weather-chart"
            aria-hidden="true"
          />
          <div key="chart-bounds" className="chart-bounds">
            <span key="chart-max">
              {Math.ceil(max)}
              {unit}
            </span>
            <span key="chart-min">
              {Math.floor(min)}
              {unit}
            </span>
          </div>
          <div key="chart-columns" className="chart-columns">
            {values.map((value, index) => (
              <div
                key={`chart-${hours[index].time}`}
                className={`chart-column chart-hour-${Number(hours[index].time.slice(11, 13))} chart-height-${Math.round(((value - min) / (max - min)) * 100)}`}
              >
                <button
                  key={`chart-point-${index}`}
                  type="button"
                  className="chart-point"
                  aria-label={`${hours[index].time.slice(11, 16)}: ${Math.round(value)}${unit}`}
                >
                  <span
                    key={`chart-tooltip-${index}`}
                    className="chart-tooltip"
                  >
                    {hours[index].time.slice(11, 16)} · {Math.round(value)}
                    {unit}
                  </span>
                </button>
              </div>
            ))}
          </div>
          <div key="chart-time" className="chart-time">
            <span key="chart-time-start">0:00</span>
            <span key="chart-time-six">6:00</span>
            <span key="chart-time-noon">12:00</span>
            <span key="chart-time-eighteen">18:00</span>
          </div>
        </div>
        {state.detail !== "sunset" && !values.length ? (
          <p key="detail-no-hours" className="detail-note">
            {message("missingHours")}
          </p>
        ) : null}
        {state.detail === "temperature" ? (
          <div
            key="temperature-tabs"
            className="temperature-tabs"
            role="group"
            aria-label={message("temperatureType")}
          >
            <button
              key="actual-tab"
              type="button"
              value="actual"
              aria-pressed={!state.apparent}
              data-redevplugin-action="detail-temperature"
            >
              {message("actual")}
            </button>
            <button
              key="apparent-tab"
              type="button"
              value="apparent"
              aria-pressed={state.apparent}
              data-redevplugin-action="detail-temperature"
            >
              {t.feelsLike}
            </button>
          </div>
        ) : null}
        <p key="detail-attribution" className="detail-note">
          {t.poweredBy}
        </p>
      </section>
    </section>
  );
}

function loadingState(t: WeatherTranslations) {
  return (
    <section
      key="loading-state"
      className="loading-state"
      aria-label={t.loading}
    >
      <span key="loading-mark" className="loading-mark" aria-hidden="true" />
      <h2 key="loading-title">{t.loading}</h2>
    </section>
  );
}

function weatherCardControls(t: WeatherTranslations) {
  const refreshing =
    state.busy === "forecast" &&
    Boolean(state.forecast) &&
    !state.pendingLocation;
  const refreshLabel = refreshing ? t.refreshing : t.refresh;
  return (
    <div key="weather-card-controls" className="weather-card-controls">
      <span key="scroll-summary" className="scroll-summary" aria-hidden="true">
        <strong key="scroll-city">
          {state.selected
            ? localizedLocation(state.selected, state.locale).name
            : undefined}
        </strong>
        <span key="scroll-temperature">
          {state.forecast
            ? `${degrees(state.forecast.current.temperature)} · ${translatedCondition(conditionForCode(state.forecast.current.weather_code, state.forecast.current.is_day).kind)}`
            : ""}
        </span>
      </span>
      <button
        key="sidebar-toggle"
        type="button"
        className="plain-button sidebar-toggle"
        title={message("toggleSidebar")}
        aria-label={message("toggleSidebar")}
        aria-expanded={!state.sidebarCollapsed}
        data-redevplugin-action="toggle-sidebar"
      >
        ◧
      </button>
      <button
        key="location-trigger"
        className="location-trigger"
        type="button"
        title={t.chooseLocation}
        aria-label={`${t.chooseLocation}: ${(state.selected ? localizedLocation(state.selected, state.locale).name : undefined) ?? t.chooseLocation}`}
        aria-expanded={state.chooserOpen}
        data-redevplugin-action="toggle-location-chooser"
      >
        <strong key="location-trigger-name" className="location-trigger-name">
          {(state.selected
            ? localizedLocation(state.selected, state.locale).name
            : undefined) ?? t.chooseLocation}
        </strong>
        <span
          key="location-trigger-arrow"
          className="location-trigger-arrow"
          aria-hidden="true"
        >
          ⌄
        </span>
      </button>
      {state.selected ? (
        <button
          key="refresh"
          className={
            refreshing
              ? "icon-button weather-card-refresh is-refreshing"
              : "icon-button weather-card-refresh"
          }
          type="button"
          title={refreshLabel}
          aria-label={refreshLabel}
          aria-busy={refreshing}
          disabled={Boolean(state.busy)}
          data-redevplugin-action="refresh-weather"
        >
          <span key="refresh-icon" className="refresh-icon" aria-hidden="true">
            ↻
          </span>
        </button>
      ) : null}
    </div>
  );
}

function locationForAction(event: PluginUIActionEvent): Location | undefined {
  const id = String(event.value ?? "");
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
    error.errorCode === "PLUGIN_PERMISSION_DENIED"
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

function reportUnhandledFailure(error: unknown): void {
  if (
    disposed &&
    error instanceof PluginBridgeError &&
    error.errorCode === "PLUGIN_BRIDGE_DISPOSED"
  )
    return;
  queueMicrotask(() => {
    throw error;
  });
}
