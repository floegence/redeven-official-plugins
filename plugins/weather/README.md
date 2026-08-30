# Weather

Weather is a Redeven-maintained official plugin that combines a calm local
clock, current conditions, and a seven-day forecast. Users can search for
places, preview forecasts, save up to eight favorites, and keep the last
successful forecast available when the weather service is temporarily offline.

The visual concept is inspired by Patrick Kissling's MIT-licensed
[clock-weather-card](https://github.com/pkissling/clock-weather-card): the clock
and weather share one surface, while daily low/high ranges reveal the weekly
temperature trend at a glance. This implementation is original ReDevPlugin
source and does not copy Home Assistant integration code, icons, or assets.

Weather and geocoding data come from
[Open-Meteo.com](https://open-meteo.com/). API data are provided under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); attribution is shown
beside every forecast and recorded in the packaged notices.

## Architecture

- The TypeScript UI runs in ReDevPlugin's opaque surface and never uses direct
  browser networking or persistence.
- The Rust WASM worker accesses only the declared Open-Meteo HTTPS origins
  through the Host network broker.
- Saved places and bounded forecast fallback data use the Host-owned user KV
  store.
- The surface follows the host appearance and locale context, with English and
  Simplified Chinese copy.

## Build and test

Requirements: Node.js 26 and npm. The repository-pinned Rust 1.88 toolchain and
`wasm32-unknown-unknown` target are selected automatically by `rustup`.

```bash
npm ci
npm test
npm run build
```

Version `1.0.1` is the stable release-train version. Build the unsigned official
package from the repository root with:

```bash
npm run package:weather
```
