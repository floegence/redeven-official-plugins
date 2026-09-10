# Forecast regression fixture

`open-meteo-ten-days.json` is a public Open-Meteo forecast response captured on
2026-09-10 for the Changsha city coordinates (28.2, 112.98). It contains the
provider timezone, current conditions, ten daily records, and 240 hourly records
requested by `forecast_url`; unused top-level provider metadata was removed.
Weather data is attributed to Open-Meteo under CC BY 4.0.

This fixture reproduces the storage failure when a full hourly forecast is
written together with seven older daily caches. Tests run without network access
and verify that persistence stays below the SDK control-message limit while
live responses retain all hours and saved location identity remains unchanged.
