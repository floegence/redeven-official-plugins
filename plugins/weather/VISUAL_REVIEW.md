# Weather visual acceptance

Weather content retains its original identity: condition-driven skies, local
day/night pictograms, temperature ranges, compass, sunset trajectory and metric
illustrations. Public Floe controls and dialogs share the host theme. The weather
palette is content, not a second theme owner or a replacement Workbench shell.
Native DOM inputs, focus, composition, selection and Canvas remain in the page.

## Data coverage

Keep two independent application fixtures. Sparse forecasts test unavailable
hourly data and optional measurements; never use them as the complete visual
acceptance fixture. The complete synthetic fixture has ten days, 240 hourly
samples, a 24-hour visible strip and all eight supported metrics. These numbers
are test data, not live observations or evidence that a provider always returns
all fields. Production must retain genuine missing data without fabricating it.

Review every supported metric, the last day, horizontal hourly scrolling and
current versus forecast temperatures. The current-hour summary must agree with
the hero even when the provider's current and hourly temperatures differ.

## Reproducible review

Run npm test in this plugin for application behavior and viewport bounds.
Set WEATHER_BROWSER_EVIDENCE_DIR to an output directory and run
node scripts/visual-review.mjs for synthetic screenshots and visual-evidence.json.
The script records cloudy weather at 390, 430, 768 and 1280 pixels in both shell
themes, plus clear day/night, rain, snow, fog and storm on mobile and desktop. The complete
images expand the viewport height to expose all content; the regular images use
a 900-pixel viewport. The browser suite separately captures Floe dialogs.

Check actual screenshots, not just test results: clear visual hierarchy, weather
identity, readable contrast, complete metrics, no clipping, actionable controls,
nighttime moon icons, and no obscured keyboard focus. Sky layers must never
receive pointer events and must honor reduced motion. Theme changes must not
replace the input node, lose composition or selections, or reinterpret local day
as night. Existing business, error recovery and localization tests remain.

## Location picker

Use a full-width recent-city list with current-city state and existing cached
weather. Manage/Done exposes separate 44-pixel remove buttons; removal must
never share the primary selection target. Suggested cities exclude recent ones.
Search, clear, and close controls remain reachable while only the results area
scrolls. Search has explicit loading, empty, failure, and result states. Clearing
or editing a pending search invalidates its eventual response. Choosing the
current city closes the picker without another request. Clear restores focus.

Check all ten locales at mobile width, long place names, light/dark themes,
390/430/768/1280 widths and a 390-by-520 short viewport. Capture only after the
Floe dialog has completed its entry animation; intermediate opacity is not a
valid visual acceptance screenshot. Preserve native composition and focus tests.

## Sidebar color continuity

The sidebar uses a darker tone of the active weather palette. Its search action,
text and separators must remain part of that palette in both host themes. City
cards retain their own weather conditions, with restrained borders and a light
selection marker. Selection and keyboard focus remain distinct; do not reuse the
host accent ring as a permanent selected-city outline. Check the entire desktop
composition for sunny, cloudy, rainy, snowy, foggy, stormy and nighttime weather.

The independent Host acceptance page has diagnostic controls outside the plugin.
Keep full-host evidence, but use separately labelled plugin-only screenshots for
application visual review so diagnostic chrome is not mistaken for product UI.

## Product acceptance

Application fixtures do not exercise package admission, host authorization or
WASM execution. Final integration also requires the released ReDevPlugin host
and actual Redeven installation, opening, interaction, closing and reopening.
Those results must be recorded separately from these application screenshots.
