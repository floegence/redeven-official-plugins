# Weather

Weather is a Redeven-maintained official plugin with an original interface
modeled on macOS Weather: an atmospheric background, a centered current-weather
summary, a collapsible city sidebar, a horizontal hourly forecast, a ten-day
temperature range list, and translucent detail cards. The dashboard scrolls
inside its plugin surface and reflows into two-column cards on small screens.

Click an hour or a forecast day to inspect its daily temperature curve and switch
between actual and apparent temperature. Wind, humidity, precipitation chance,
sunset, UV index, visibility, and sea-level pressure have detail panels. Charts
support keyboard-focusable hourly values; Escape or the backdrop closes a panel.
A single SDK-owned canvas remains mounted across date changes and panel opens.
If canvas allocation is unavailable, an accessible CSS chart remains visible.

Users can search places and automatically retain their eight most recently
selected cities. Cached city summaries appear in the sidebar with observation
times available on hover. The last successful forecast renders immediately while
a refresh runs. Selecting a city keeps the previous forecast visible and shows
pending feedback; rapid selections are queued, and only the latest selection can
replace the visible city. A failed request preserves the existing forecast and
keeps selection and retry available.

Day/night, clouds, rain, and snow use original CSS effects. Reduced-motion
preferences disable decorative animation and transitions. No Apple code,
artwork, screenshots, weather service, or proprietary visual assets are bundled.
The earlier clock-and-weather layout was inspired by Patrick Kissling's
MIT-licensed clock-weather-card; its credit remains in the notices.

## Data and compatibility

Weather and geocoding data come from [Open-Meteo](https://open-meteo.com/).
Data attribution (CC BY 4.0), observation time, and forecast timezone appear below
the dashboard. The provider can return up to ten days and 240 hourly observations.
Unavailable optional UV, visibility, pressure, or wind observations remain absent;
they are never substituted with zero. Existing stored forecasts remain readable
and show their original day count until refreshed. Hourly details are not
fabricated for older cached forecasts.

Air-quality maps, severe-weather alerts, lunar imagery, historical averages,
Apple's volumetric sky renderer, and platform-native window chrome are outside
this implementation. Precipitation displays daily totals when supplied, with hourly probability in
the detail chart; older forecasts fall back to probability.
The sunset arc is illustrative; the displayed sunrise/sunset times are data.

## Architecture

- The TypeScript UI uses the released ReDevPlugin opaque surface renderer and
  bridge. It never performs direct browser networking or persistence.
- The Rust WASM worker uses the Host network broker for the declared Open-Meteo
  HTTPS origins and the Host-owned user KV store for recent cities and caches.
- Plugin-local response schemas in the manifest describe hourly observations
  and cached sidebar summaries. No platform protocol or host policy is forked.
- English and Simplified Chinese follow the surface locale. Weather determines
  the atmospheric palette rather than the host shell's light/dark background.

## Build and test

Requirements: Node.js 26 and npm. The repository-pinned Rust 1.88 toolchain and
`wasm32-unknown-unknown` target are selected by `rustup`.

```bash
npm ci
npm test
npm run build
```

The source release-train version is `1.0.41`. Official distribution uses its
signed release reference; a local build does not replace installed plugins.
Build an unsigned review package from the repository root with:

```bash
npm run package:weather
```

## Visual review

From this plugin directory, run:

```bash
node scripts/preview.mjs
```

Open `http://127.0.0.1:4178`. This loopback-only fixture host uses the exact
published ReDevPlugin SDK, opaque iframe, MessageChannel, worker, renderer, and
canvas path. It supplies synthetic city/weather responses instead of running a
WASM worker or a live Redeven session. It is not an installation or admission
path and is excluded from plugin packages.

Use `?width=390&height=700` for a narrow surface, `?locale=en-US` for English,
`?code=61` for rain, or `?code=0&night=1` for a clear night. Restart the preview
script after changing TypeScript; CSS is read on every surface load.
The review notes are in [VISUAL_REVIEW.md](VISUAL_REVIEW.md).

## Languages

The surface follows the host language context and supports English, Simplified
Chinese, Traditional Chinese, Japanese, Korean, German, French, Spanish,
Brazilian Portuguese, and Russian. Language changes relabel controls, details,
existing notices, and known saved city presets without changing location identity.
Search requests use the selected provider language. Names of arbitrary saved
search results retain the provider's original spelling; no background translation
requests are made. Unsupported languages fall back to English.

Forecast dates retain the provider's civil date rather than shifting with the
browser time zone. Numbers use locale-aware formatting; weather units remain
metric across languages. Long labels wrap, and the date strip scrolls horizontally.
