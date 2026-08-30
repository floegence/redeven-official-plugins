use base64::Engine as _;
use redevplugin_worker_sdk::http::{HttpRequest, RedirectMode, RequestBody};
use redevplugin_worker_sdk::storage::kv;
use redevplugin_worker_sdk::{
    IO_FLAG_EOF, MAX_IO_CHUNK_BYTES, WorkerError, WorkerRequest, WorkerResult, export_worker,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const STORE_ID: &str = "weather";
const STATE_KEY: &str = "state-v1.json";
const STATE_SCHEMA_VERSION: u32 = 1;
const MAX_FAVORITES: usize = 8;
const MAX_RESPONSE_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Location {
    id: String,
    name: String,
    #[serde(default)]
    admin1: String,
    #[serde(default)]
    country: String,
    latitude: f64,
    longitude: f64,
    timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Forecast {
    timezone: String,
    timezone_abbreviation: String,
    source: String,
    current: CurrentWeather,
    days: Vec<ForecastDay>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CurrentWeather {
    time: String,
    temperature: f64,
    apparent_temperature: f64,
    humidity: f64,
    weather_code: i64,
    wind_speed: f64,
    is_day: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ForecastDay {
    date: String,
    weather_code: i64,
    temperature_max: f64,
    temperature_min: f64,
    precipitation_probability: f64,
    sunrise: String,
    sunset: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ForecastCache {
    location_id: String,
    forecast: Forecast,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredState {
    schema_version: u32,
    favorites: Vec<Location>,
    selected: Option<Location>,
    caches: Vec<ForecastCache>,
}

impl Default for StoredState {
    fn default() -> Self {
        Self {
            schema_version: STATE_SCHEMA_VERSION,
            favorites: Vec::new(),
            selected: None,
            caches: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchRequest {
    query: String,
    language: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RemoveRequest {
    id: String,
}

#[derive(Deserialize)]
struct GeocodingResponse {
    #[serde(default)]
    results: Vec<GeocodingPlace>,
}

#[derive(Deserialize)]
struct GeocodingPlace {
    id: i64,
    name: String,
    #[serde(default)]
    admin1: String,
    #[serde(default)]
    country: String,
    latitude: f64,
    longitude: f64,
    #[serde(default = "automatic_timezone")]
    timezone: String,
}

#[derive(Deserialize)]
struct RawForecast {
    timezone: String,
    #[serde(default)]
    timezone_abbreviation: String,
    current: RawCurrent,
    daily: RawDaily,
}

#[derive(Deserialize)]
struct RawCurrent {
    time: String,
    temperature_2m: f64,
    apparent_temperature: f64,
    relative_humidity_2m: f64,
    weather_code: i64,
    wind_speed_10m: f64,
    is_day: i64,
}

#[derive(Deserialize)]
struct RawDaily {
    time: Vec<String>,
    weather_code: Vec<i64>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    precipitation_probability_max: Vec<f64>,
    sunrise: Vec<String>,
    sunset: Vec<String>,
}

fn handle(request: WorkerRequest) -> WorkerResult {
    match request.method.as_str() {
        "weather.state.load" => load_public_state(),
        "weather.locations.search" => search_locations(decode(request.params)?),
        "weather.locations.remove" => remove_location(decode(request.params)?),
        "weather.forecast" => forecast_for_location(decode(request.params)?),
        _ => Err(WorkerError::invalid_request("unsupported Weather method")),
    }
}

fn load_public_state() -> WorkerResult {
    let state = load_state()?;
    let forecast = cached_forecast_for_selected(&state);
    Ok(json!({
        "favorites": state.favorites,
        "selected": state.selected,
        "forecast": forecast,
    }))
}

fn cached_forecast_for_selected(state: &StoredState) -> Option<Forecast> {
    let selected = state.selected.as_ref()?;
    let mut forecast = state
        .caches
        .iter()
        .find(|cache| cache.location_id == selected.id)?
        .forecast
        .clone();
    forecast.source = "saved".to_owned();
    Some(forecast)
}

fn search_locations(request: SearchRequest) -> WorkerResult {
    let query = request.query.trim();
    if query.chars().count() < 2 || query.len() > 120 {
        return Err(WorkerError::invalid_request(
            "location query must contain 2 to 120 characters",
        ));
    }
    if request.language != "en" && request.language != "zh" {
        return Err(WorkerError::invalid_request("search language is invalid"));
    }
    let url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=8&language={}&format=json",
        percent_encode(query),
        request.language,
    );
    let response: GeocodingResponse = http_get_json(&url)?;
    let locations = response
        .results
        .into_iter()
        .filter_map(project_location)
        .take(MAX_FAVORITES)
        .collect::<Vec<_>>();
    Ok(json!({ "locations": locations }))
}

fn remove_location(request: RemoveRequest) -> WorkerResult {
    validate_id(&request.id)?;
    let mut state = load_state()?;
    state.favorites.retain(|item| item.id != request.id);
    save_state(&state)?;
    Ok(json!({ "favorites": state.favorites }))
}

fn forecast_for_location(location: Location) -> WorkerResult {
    validate_location(&location)?;
    let mut state = load_state()?;
    remember_location(&mut state, &location);
    state.selected = Some(location.clone());
    match fetch_forecast(&location) {
        Ok(forecast) => {
            state.caches.retain(|item| item.location_id != location.id);
            state.caches.insert(
                0,
                ForecastCache {
                    location_id: location.id.clone(),
                    forecast: forecast.clone(),
                },
            );
            state.caches.truncate(MAX_FAVORITES);
            save_state(&state)?;
            Ok(json!({ "location": location, "forecast": forecast, "favorites": state.favorites }))
        }
        Err(network_error) => {
            let Some(cache) = state
                .caches
                .iter()
                .find(|item| item.location_id == location.id)
            else {
                save_state(&state)?;
                return Err(network_error);
            };
            let mut saved = cache.forecast.clone();
            saved.source = "saved".to_string();
            save_state(&state)?;
            Ok(json!({ "location": location, "forecast": saved, "favorites": state.favorites }))
        }
    }
}

fn remember_location(state: &mut StoredState, location: &Location) {
    state.favorites.retain(|item| item.id != location.id);
    state.favorites.insert(0, location.clone());
    state.favorites.truncate(MAX_FAVORITES);
}

fn fetch_forecast(location: &Location) -> Result<Forecast, WorkerError> {
    let raw: RawForecast = http_get_json(&forecast_url(location))?;
    project_forecast(raw)
}

fn forecast_url(location: &Location) -> String {
    format!(
        concat!(
            "https://api.open-meteo.com/v1/forecast?latitude={:.5}&longitude={:.5}",
            "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
            "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
            "&temperature_unit=celsius&wind_speed_unit=kmh&timezone={}&forecast_days=7"
        ),
        location.latitude,
        location.longitude,
        percent_encode(&location.timezone),
    )
}

fn project_forecast(raw: RawForecast) -> Result<Forecast, WorkerError> {
    let day_count = raw.daily.time.len();
    if day_count == 0
        || day_count > 7
        || [
            raw.daily.weather_code.len(),
            raw.daily.temperature_2m_max.len(),
            raw.daily.temperature_2m_min.len(),
            raw.daily.precipitation_probability_max.len(),
            raw.daily.sunrise.len(),
            raw.daily.sunset.len(),
        ]
        .into_iter()
        .any(|length| length != day_count)
    {
        return Err(WorkerError::new(
            "WEATHER_SERVICE_FAILED",
            "forecast days are incomplete",
        ));
    }
    let current = CurrentWeather {
        time: raw.current.time,
        temperature: finite(raw.current.temperature_2m, "current temperature")?,
        apparent_temperature: finite(raw.current.apparent_temperature, "apparent temperature")?,
        humidity: bounded(raw.current.relative_humidity_2m, 0.0, 100.0, "humidity")?,
        weather_code: raw.current.weather_code,
        wind_speed: bounded(raw.current.wind_speed_10m, 0.0, 1_000.0, "wind speed")?,
        is_day: raw.current.is_day != 0,
    };
    let mut days = Vec::with_capacity(day_count);
    for index in 0..day_count {
        let maximum = finite(raw.daily.temperature_2m_max[index], "maximum temperature")?;
        let minimum = finite(raw.daily.temperature_2m_min[index], "minimum temperature")?;
        if minimum > maximum {
            return Err(WorkerError::new(
                "WEATHER_SERVICE_FAILED",
                "forecast temperature range is invalid",
            ));
        }
        days.push(ForecastDay {
            date: raw.daily.time[index].clone(),
            weather_code: raw.daily.weather_code[index],
            temperature_max: maximum,
            temperature_min: minimum,
            precipitation_probability: bounded(
                raw.daily.precipitation_probability_max[index],
                0.0,
                100.0,
                "precipitation probability",
            )?,
            sunrise: raw.daily.sunrise[index].clone(),
            sunset: raw.daily.sunset[index].clone(),
        });
    }
    Ok(Forecast {
        timezone: raw.timezone,
        timezone_abbreviation: raw.timezone_abbreviation,
        source: "network".to_string(),
        current,
        days,
    })
}

fn project_location(place: GeocodingPlace) -> Option<Location> {
    let location = Location {
        id: format!("open-meteo:{}", place.id),
        name: place.name.trim().to_string(),
        admin1: place.admin1.trim().to_string(),
        country: place.country.trim().to_string(),
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone.trim().to_string(),
    };
    validate_location(&location).ok().map(|_| location)
}

fn load_state() -> Result<StoredState, WorkerError> {
    let response = match kv::get(kv::GetRequest {
        store_id: STORE_ID.to_string(),
        key: STATE_KEY.to_string(),
        max_bytes: Some(768 * 1024),
    }) {
        Ok(response) => response,
        Err(error) if error.code == "NOT_FOUND" => return Ok(StoredState::default()),
        Err(error) => return Err(error),
    };
    let bytes = redevplugin_worker_sdk::decode_base64(&response.value_base64)?;
    let state: StoredState = serde_json::from_slice(&bytes)
        .map_err(|error| WorkerError::hostcall(format!("decode weather state: {error}")))?;
    validate_state(&state)?;
    Ok(state)
}

fn save_state(state: &StoredState) -> Result<(), WorkerError> {
    validate_state(state)?;
    let bytes = serde_json::to_vec(state)
        .map_err(|error| WorkerError::hostcall(format!("encode weather state: {error}")))?;
    let value_base64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    kv::put(kv::PutRequest {
        store_id: STORE_ID.to_string(),
        key: STATE_KEY.to_string(),
        value_base64,
    })?;
    Ok(())
}

fn validate_state(state: &StoredState) -> Result<(), WorkerError> {
    if state.schema_version != STATE_SCHEMA_VERSION
        || state.favorites.len() > MAX_FAVORITES
        || state.caches.len() > MAX_FAVORITES
    {
        return Err(WorkerError::hostcall("weather state is incompatible"));
    }
    for location in state.favorites.iter().chain(state.selected.iter()) {
        validate_location(location)
            .map_err(|_| WorkerError::hostcall("weather state contains an invalid location"))?;
    }
    if state
        .caches
        .iter()
        .any(|cache| cache.location_id.is_empty() || cache.forecast.days.is_empty())
    {
        return Err(WorkerError::hostcall(
            "weather state contains an invalid forecast",
        ));
    }
    Ok(())
}

fn validate_location(location: &Location) -> Result<(), WorkerError> {
    validate_id(&location.id)?;
    if location.name.trim().is_empty()
        || location.name.len() > 160
        || location.admin1.len() > 160
        || location.country.len() > 160
        || location.timezone.trim().is_empty()
        || location.timezone.len() > 120
        || !location.latitude.is_finite()
        || !(-90.0..=90.0).contains(&location.latitude)
        || !location.longitude.is_finite()
        || !(-180.0..=180.0).contains(&location.longitude)
    {
        return Err(WorkerError::invalid_request("location is invalid"));
    }
    Ok(())
}

fn validate_id(id: &str) -> Result<(), WorkerError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err(WorkerError::invalid_request("location id is invalid"));
    }
    Ok(())
}

fn http_get_json<T: DeserializeOwned>(url: &str) -> Result<T, WorkerError> {
    let request = RequestBody::begin(HttpRequest {
        method: "GET".to_string(),
        url: url.to_string(),
        headers: Vec::new(),
        redirect: RedirectMode::Error,
        timeout_ms: Some(12_000),
    })?;
    let response = request.finish()?;
    if !(200..300).contains(&response.status) {
        let status = response.status;
        let _ = response.body.close();
        return Err(WorkerError::new(
            "WEATHER_SERVICE_FAILED",
            format!("weather service returned HTTP {status}"),
        ));
    }
    let mut body = response.body;
    let mut bytes = Vec::new();
    loop {
        let (chunk, flags) = body.read(MAX_IO_CHUNK_BYTES)?;
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            let _ = body.close();
            return Err(WorkerError::new(
                "WEATHER_SERVICE_FAILED",
                "weather response exceeds the size limit",
            ));
        }
        if chunk.is_empty() && flags & IO_FLAG_EOF == 0 {
            let _ = body.close();
            return Err(WorkerError::hostcall("weather response made no progress"));
        }
        bytes.extend_from_slice(&chunk);
        if flags & IO_FLAG_EOF != 0 {
            body.close()?;
            break;
        }
    }
    serde_json::from_slice(&bytes).map_err(|error| {
        WorkerError::new(
            "WEATHER_SERVICE_FAILED",
            format!("decode weather response: {error}"),
        )
    })
}

fn percent_encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

fn finite(value: f64, label: &str) -> Result<f64, WorkerError> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(WorkerError::new(
            "WEATHER_SERVICE_FAILED",
            format!("forecast {label} is invalid"),
        ))
    }
}

fn bounded(value: f64, minimum: f64, maximum: f64, label: &str) -> Result<f64, WorkerError> {
    let value = finite(value, label)?;
    if (minimum..=maximum).contains(&value) {
        Ok(value)
    } else {
        Err(WorkerError::new(
            "WEATHER_SERVICE_FAILED",
            format!("forecast {label} is out of range"),
        ))
    }
}

fn decode<T: DeserializeOwned>(value: Value) -> Result<T, WorkerError> {
    serde_json::from_value(value)
        .map_err(|error| WorkerError::invalid_request(format!("decode Weather request: {error}")))
}

fn automatic_timezone() -> String {
    "auto".to_string()
}

export_worker!(handle);

#[cfg(test)]
mod tests {
    use super::*;

    fn location() -> Location {
        Location {
            id: "open-meteo:2950159".to_string(),
            name: "Berlin".to_string(),
            admin1: "Berlin".to_string(),
            country: "Germany".to_string(),
            latitude: 52.52,
            longitude: 13.41,
            timezone: "Europe/Berlin".to_string(),
        }
    }

    fn raw_forecast() -> RawForecast {
        serde_json::from_value(json!({
            "timezone": "Europe/Berlin",
            "timezone_abbreviation": "CEST",
            "current": {
                "time": "2026-08-29T10:00",
                "temperature_2m": 19.4,
                "apparent_temperature": 18.9,
                "relative_humidity_2m": 58,
                "weather_code": 2,
                "wind_speed_10m": 11.2,
                "is_day": 1
            },
            "daily": {
                "time": ["2026-08-29", "2026-08-30"],
                "weather_code": [2, 61],
                "temperature_2m_max": [22.0, 19.0],
                "temperature_2m_min": [13.0, 11.0],
                "precipitation_probability_max": [10, 70],
                "sunrise": ["2026-08-29T06:10", "2026-08-30T06:12"],
                "sunset": ["2026-08-29T19:58", "2026-08-30T19:56"]
            }
        }))
        .expect("raw forecast")
    }

    #[test]
    fn percent_encoding_preserves_query_boundaries() {
        assert_eq!(
            percent_encode("São Paulo & SP"),
            "S%C3%A3o%20Paulo%20%26%20SP"
        );
    }

    #[test]
    fn forecast_url_is_exactly_bound_to_open_meteo() {
        let url = forecast_url(&location());
        assert!(url.starts_with("https://api.open-meteo.com/v1/forecast?"));
        assert!(url.contains("latitude=52.52000"));
        assert!(url.contains("timezone=Europe%2FBerlin"));
        assert!(url.ends_with("forecast_days=7"));
    }

    #[test]
    fn forecast_projection_rejects_misaligned_days() {
        let mut raw = raw_forecast();
        raw.daily.sunset.pop();
        let error = project_forecast(raw).expect_err("misaligned forecast must fail");
        assert_eq!(error.code, "WEATHER_SERVICE_FAILED");
    }

    #[test]
    fn forecast_projection_returns_bounded_public_data() {
        let forecast = project_forecast(raw_forecast()).expect("forecast");
        assert_eq!(forecast.source, "network");
        assert_eq!(forecast.days.len(), 2);
        assert_eq!(forecast.days[1].precipitation_probability, 70.0);
        assert!(forecast.current.is_day);
    }

    #[test]
    fn location_validation_rejects_unbounded_identity() {
        let mut invalid = location();
        invalid.id = "../berlin".to_string();
        assert!(validate_location(&invalid).is_err());
    }

    #[test]
    fn stored_state_is_bounded() {
        let state = StoredState {
            favorites: vec![location(); MAX_FAVORITES + 1],
            ..StoredState::default()
        };
        assert!(validate_state(&state).is_err());
    }

    #[test]
    fn selected_locations_are_remembered_once_in_recent_order() {
        let mut state = StoredState::default();
        for index in 0..=MAX_FAVORITES {
            let mut candidate = location();
            candidate.id = format!("open-meteo:{index}");
            candidate.name = format!("City {index}");
            remember_location(&mut state, &candidate);
        }

        assert_eq!(state.favorites.len(), MAX_FAVORITES);
        assert_eq!(state.favorites[0].id, format!("open-meteo:{MAX_FAVORITES}"));
        assert_eq!(state.favorites.last().map(|item| item.id.as_str()), Some("open-meteo:1"));

        let existing = state.favorites[3].clone();
        remember_location(&mut state, &existing);
        assert_eq!(state.favorites.len(), MAX_FAVORITES);
        assert_eq!(state.favorites[0], existing);
        assert_eq!(state.favorites.iter().filter(|item| item.id == existing.id).count(), 1);
    }

    #[test]
    fn selected_cache_is_projected_as_saved_without_mutating_stored_data() {
        let mut stored = project_forecast(raw_forecast()).expect("forecast");
        stored.source = "network".to_string();
        let selected = location();
        let state = StoredState {
            selected: Some(selected.clone()),
            caches: vec![ForecastCache {
                location_id: selected.id,
                forecast: stored.clone(),
            }],
            ..StoredState::default()
        };

        let cached = cached_forecast_for_selected(&state).expect("selected cache");
        assert_eq!(cached.source, "saved");
        assert_eq!(stored.source, "network");
        assert_eq!(state.caches[0].forecast.source, "network");
    }
}
