# macOS Weather comparison

Reviewed on macOS on 2026-09-10 against the running Weather app, using Changsha
(cloudy) and Beijing (clear) for reference. The original plugin source was
`979cf3f` on `origin/main`. Visual comparison used the released
`@floegence/redevplugin-ui@3.0.18` renderer with fixture responses, rather than a
separate HTML recreation of the plugin. No Apple images or source were copied.

## A/B passes

| Pass | Observed difference | Resolution |
| --- | --- | --- |
| Original | Large clock, white surface, compact metric strip, seven-day list, no native-style background or detail panels | Replaced with an atmospheric weather dashboard, city sidebar, hourly forecast, ten-day list, and translucent metric cards |
| First implementation | Daily column was too wide; labels and icons inside buttons could consume clicks without the button value | Reduced the desktop forecast to roughly one third of the content grid; made action-button children non-interactive hit targets |
| Desktop refinement | High/low temperature hierarchy was too small; hourly row needed tighter spacing | Adjusted the temperature typography, card spacing, and hourly strip against the 1262×768 native reference |
| Detail refinement | Stepped CSS curve, overly wide panel, and a transferred canvas was removed on date change | Added a monotone interpolated canvas curve; narrowed the panel; kept one canvas mounted for the entire surface lifetime |
| Responsive refinement | Small screens needed complete cards and reachable controls; scrolled content lost city context | Reflowed to two columns, kept horizontal hourly scrolling, and added a compact scroll-driven city summary with a non-animated fallback |
| Data refinement | Empty sidebar summaries on startup and precipitation probability differed from the native totals card | Projected bounded cached city summaries; added provider-backed daily precipitation totals with an old-cache probability fallback |

## Verification

- Compared the native macOS app, the original plugin, and the revised plugin at
  desktop size. The main temperature hierarchy, sidebar proportions, forecast
  row dimensions, card material, and spacing are visually aligned within the
  intentionally smaller supported component set.
- Checked 390-pixel and 320-pixel plugin containers, including English and Chinese
  copy, local scrolling, and cards near the bottom of the dashboard.
- Exercised location search, Enter submission, result selection, pending feedback,
  the automatic close after success, and the city sidebar.
- Exercised hourly/day detail opening, date changes, actual/apparent temperature
  switching, Escape, and repeated opening/closing through the real SDK sandbox.
- Verified that the canvas remains usable after date changes and panel closure.
  Unit tests additionally cover missing data, out-of-range day selections, future
  metric units, and forecast-local hour positions.
- Inspected original cloud/clear views and the revised cloud/night palettes.
  Decorative cloud/rain/snow animation and reduced-motion rules are implemented
  in CSS; the latter has source-level regression coverage.
- A live Open-Meteo request for the selected public city coordinates returned ten
  dates and 240 hourly records. Live provider values are not the fixture host's
  synthetic review values.
- Ran the repository test suite, source checks, catalog verification, the Weather
  UI/WASM build, and the released ReDevPlugin CLI package/validation flow.

## Intentional limits

This is an original web implementation, not pixel-identical Apple Weather.
Apple's volumetric cloud renderer, air-quality maps, severe-weather alerts, moon
imagery, historical comparisons, native window chrome, and anchored system
popovers are not reproduced. Details use a centered, keyboard-accessible panel;
wind uses km/h. The sun arc is illustrative, while its times are provider data.
Unavailable provider fields are omitted rather than displayed as zero.

The fixture host verifies the actual released iframe/worker/renderer path, but it
is not an end-to-end test of an installed plugin in a live Redeven session. Release `1.0.41` contains the reviewed implementation and the ten-language
adaptation. Installation and update state remain owned by the host.

## Localization follow-up

All ten supported language contexts render through SDK reconciliation tests,
including detail panels, localized civil dates, and placeholder completeness.
Traditional Chinese has independent copy. Context changes retranslate existing
notices and saved preset labels. Provider search languages remain a closed list
shared by the manifest and WASM worker. Non-preset proper names retain the
provider's spelling rather than being guessed or translated without a request.

The final localization pass exercised German details at 390 pixels, Russian
metric cards at 320 pixels, and the Traditional Chinese dashboard and city
picker at 390 pixels. Long metric notes wrap and adjacent cards stretch to a
shared row height. The detail date strip stays scrollable without a bright
platform scrollbar. Numeric precipitation totals use the locale's decimal
separator. Automated render coverage additionally checks the other seven
language contexts using the same released SDK reconciler.

The follow-up also corrected the wider Russian/French “Today” label columns and
an SDK-global duplicate key in the sunset illustration shared by the card and
detail panel. A regression now opens every metric repeatedly, including sunset,
through the released SDK tree validator.

## Installed-release regression follow-up (1.0.42)

The installed 1.0.41 release exposed two gaps in the fixture-only review. A live
240-hour response plus saved cities exceeded the SDK's 64 KiB control envelope
when encoded as one base64 KV value. Separately, the 1400-pixel breakpoint mixed
daily-row spans with optional metric spans and left holes for older caches.

Version 1.0.42 caps persisted JSON at 40 KiB and keeps hourly detail in live
responses. A captured ten-day provider fixture reproduces the previous overflow
and checks all eight saved cities, retained daily summaries, full live hours,
and repeatable cache writes. Failed refreshes explicitly identify saved weather.

The daily forecast and metrics now occupy independent grid regions. Five to
eight metrics fill complete rows, row heights align, and the forecast column
stretches to the same bottom edge. City names use the available card width.
Responsive review covers 390-pixel, desktop, and 1880-pixel containers, including
older seven-day data and missing optional metrics.

### Live Redeven installation verification

The immutable 1.0.42 release was installed through Redeven's normal official
update review on 2026-09-10, retaining the existing grants and all eight saved
cities. The initial live refresh replaced the old seven-day view with hourly
observations, ten daily rows, and eight metrics without an unavailable notice.
A second refresh and a round trip between Beijing and Changsha both succeeded.
The host diagnostic feed recorded no new Weather method rejections during these
checks; the previous installation had recorded repeated rejections.

In the running installed surface, the sidebar city names were readable, adjacent
metric cards shared row heights, and the forecast and metric regions ended on
the same baseline. The lower row had no empty grid tracks. Temperature details
rendered a live curve after changing the date and selecting apparent temperature.
Escape, closing and reopening details, sunset, and pressure details remained
functional. The native macOS Weather reference was inspected again during this
pass. The implementation retains the intentional component limits above.

Source CI, signed publication, and market ingestion succeeded. All eleven
GitHub release files matched the locally verified release output byte for byte;
the public stable market projection reported 1.0.42 with the same package hash.

## Resize and selection follow-up (1.0.43)

Existing city selections previously moved the city to the top of the persisted
list. They now update metadata in place, preserving order across storage reloads.
Cache recency independently decides eviction when adding a ninth city. The
requested city highlights immediately; the loading status occupies the existing
toolbar without displacing the forecast. Repeated clicks on the same selected or
pending city do not request duplicate forecasts. Regression tests also cover
rapid selection, last-request ownership, failed requests, and retry.

The city sidebar is flush with the surface edges and has no outer rounded frame.
Only its own collapse button is shown while expanded; the main toolbar offers a
reopen button after explicit collapse. Narrow layouts keep the city picker.

Cloud textures now have fixed raster dimensions between breakpoints and fade
inside their bounds. Card, sidebar, toolbar, and overlay fills avoid backdrop blur,
and precipitation overscan is limited to its animation travel. The original
weather palettes and reduced-motion behavior remain. The final visual pass
checked Chinese desktop, German 390-pixel layouts, rainy 2400-pixel layouts,
city switching, and readable overlays.

### Controlled resize comparison

On the same macOS machine and in-app browser, the released SDK fixture surface
ran four width sweeps between 640 and 2400 pixels at a 2400×1400 viewport with
rain, for 240 measured frames. The baseline was the exact 1.0.42 stylesheet;
both variants used the same current UI and fixture data.

| Stylesheet | Total frame intervals | Mean | p95 | Intervals over 33.4 ms |
| --- | --- | --- | --- | --- |
| 1.0.42, first pass | 5417 ms | 22.6 ms | 34.0 ms | 34 |
| 1.0.42, repeated pass | 5733 ms | 23.9 ms | 34.1 ms | 35 |
| 1.0.43, final cloud/card treatment | 4033 ms | 16.8 ms | 17.5 ms | 0 |

These are parent requestAnimationFrame intervals during resizing, not measured
GPU presentation times or a guarantee for every host/window size. At a smaller
1517×800 cloudy viewport, both versions were near the display cadence, so that
case alone did not establish the improvement. Live installed-host verification
is recorded separately after publication.

### Installed 1.0.43 verification

The immutable release was installed through Redeven's official update review on
2026-09-10, retaining existing grants and all eight saved cities. The activity
sidebar remained pinned. Changsha → Beijing → Tokyo and Dubai → Singapore
finished on the requested city without reordering the list. After scrolling the
city list to its bottom, selecting Sydney retained both its position and the
sidebar scroll offset. Returning to Changsha and refreshing succeeded.

The installed rain surface was resized repeatedly between 1102, 1202, and 1517
pixels at 735 pixels high. Each resulting layout filled the current surface
without a stale-size gap, and the final window was restored to 1517×735. This
native interaction check complements the controlled frame-interval measurements
above; it does not add a native GPU timing claim.

The full-height, square-edged sidebar, single visible collapse/reopen control,
weather-tinted cards, live temperature curve, and Escape dismissal were checked
in the installed surface. The native macOS Weather reference was inspected again.
No new Weather diagnostic events appeared after the pre-update sequence 330
during installation, city switching, resizing, refresh, and detail checks.

Source CI, signed release publication, and market ingestion succeeded. All eleven
release files matched the locally verified signed output, and an independent
ReDevPlugin 3.0.25 verification passed. The public market reported visible 1.0.43
from tag v1.0.43 at commit ebbcd58678a0d796a2e7241d5beaee0bd510ecf1 with
the same package digest as the downloaded release.
