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
is not an end-to-end test of an installed plugin in a live Redeven session. The
new code is private feature-branch work. The generated unsigned review package
is not a published release, and existing installations have not been replaced.
