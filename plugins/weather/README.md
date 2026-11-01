# Weather

Weather is a Redeven-maintained application with a responsive Floe dashboard,
recent-city sidebar, hourly conditions, daily temperature ranges, and metric
details. Controls and dialogs follow the host language and light/dark appearance.
The sky, weather pictograms and city cards follow the actual condition and local
day/night data; switching the shell theme never changes the weather. Its original
package-local icon and Open-Meteo attribution remain part of the package.

The application is ordinary Solid.js: Vite builds HTML, ES modules and CSS;
DOM inputs, focus, composition, selection, dialogs and Canvas stay in the page.
The public ReDevPlugin SDK is used at the host boundary for context, lifecycle
and calls to the existing WASM weather worker. No VNode renderer, UI action
protocol or canvas forwarding remains.

## Behavior

The first application frame uses the authenticated host appearance and locale.
Startup keeps a neutral themed surface until saved weather is available; it never
guesses a daytime sky. Restored forecasts remain visible through refresh failure.
Hidden surfaces pause cloud animation and clock updates.

The last successful forecast renders before a background refresh. Selecting a
city keeps that forecast visible while immediate pending feedback identifies the
new choice. Rapid selections are serialized; only the last choice can replace
the visible forecast. Repeating an active or pending city does not duplicate a
request. Failure preserves the prior forecast and makes retry available.

First use opens the same compact location picker with one title and no repeated
instructions. Search stays fixed while the city list scrolls, including in short
windows. Input method composition retains focus and does not submit a search
before completion.

Search and recent cities share one location picker. Recent cities have full-row
targets, current-city state and available cached weather; Manage/Done reveals
separate remove controls. Suggested cities exclude recent entries. Search stays
visible while the list scrolls, and explicit results or empty states replace
unrelated choices. Clearing a pending query discards its eventual response. Users can retain eight
cities; existing cities keep their positions and new cities replace the oldest
cache when full. Cached city summaries retain their observation times. All ten
languages follow the host context, including notices and known city presets.
Arbitrary provider names keep their original spelling. Forecast dates use the
provider's civil date and weather units remain metric.

Hourly and daily forecasts open temperature details; wind, humidity,
precipitation, sunrise/sunset, UV, visibility and pressure retain metric panels.
Floe Dialog owns modal focus, Escape and backdrop dismissal. Native Canvas draws
the curve, while keyboard-focusable hourly values remain available alongside
it. Optional missing values stay absent rather than becoming zero. The current-hour
summary uses the current observation, matching the hero; later hours use their
forecast values. Pressure includes its hPa unit. Reduced motion
is respected. Mobile layouts work without hover or the desktop sidebar.

## Data and ownership

Weather and geocoding use Open-Meteo. The existing Rust WASM worker calls the
platform broker for the declared HTTPS origins and uses its owner-scoped KV
store. The UI migration does not change the storage namespace, schema or quota.
Existing recent cities and daily caches remain readable. Cached data is marked
when a fresh request is unavailable; missing hourly observations are not invented.
Data attribution, observation time and forecast timezone stay visible.

Only UI resources and the declared WASM worker enter the installable package.
Node, Vite, test fixtures and local development commands are author tools, never
installed backend processes or admission paths.

## Build and acceptance

Run npm ci, npm test, npm run typecheck, and npm run build in this directory.
The project file redevplugin.project.json gives the released CLI the existing
build/test commands. From the repository root, npm run package:weather builds
and validates an unsigned review package through the published generic packager.
Official publication uses the neutral external-signer flow and exact reference.
Version 1.0.46 republishes the weather-aligned sidebar through the unified
package-signature contract. The release verifier checks the embedded package
signature as well as the release metadata; host admission verifies the same
portable envelope independently of the download source.

The browser suite uses the real Solid/Floe application and the released production-client test harness with controlled business
responses. It covers slow/failing/queued city selection, native input composition,
focus restoration, Canvas, ten locales and light/dark layouts at 390, 430, 768
and 1280 pixels. That suite is application evidence; the released CLI preview and
actual Redeven Browser/Desktop acceptance separately prove platform integration.

For a local UI preview, run node scripts/preview.mjs; the fixture preview binds
only to loopback at port 4178. It does not install plugins or grant authority.
Use ?initial=false&locale=zh-CN for onboarding. The default preview URL uses ?fixture=full&auto=1 for synthetic ten-day weather
and automatic responses. Add &sky=sunny, night, rain, snow, fog or storm to review
other conditions. Deterministic tests retain the sparse fixture and explicitly
settle responses. Production output contains neither fixtures nor their helper.

## Attribution

Open-Meteo data is CC BY 4.0. The earlier clock-weather-card inspiration retains
its MIT attribution in THIRD_PARTY_NOTICES.txt. No Apple artwork, code, services
or screenshots are bundled. Air quality, alerts, historical averages and native
window chrome remain outside this application.
