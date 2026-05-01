// Orchestrates: Open-Meteo fetch -> WeatherReadings upsert ->
// PressureScores compute (with 5-day trailing window) -> upsert.
//
// Used by both the daily cron and the on-create backfill.

import {
  type Location,
  listWeatherForLocation,
  upsertPressureScore,
  upsertWeatherReading,
} from "./airtable";
import { addDays, WEATHER_BACKFILL_START, yesterdayUTC } from "./dates";
import { fetchDailyRange } from "./open-meteo";
import { smithKerns } from "./smith-kerns";

type IngestSummary = {
  locationId: string;
  daysFetched: number;
  pressureRowsWritten: number;
  startDate: string;
  endDate: string;
};

export async function ingestWeather(
  location: Location,
  opts: { startDate: string; endDate: string }
): Promise<IngestSummary> {
  const days = await fetchDailyRange({
    latitude: location.latitude,
    longitude: location.longitude,
    startDate: opts.startDate,
    endDate: opts.endDate,
  });

  for (const d of days) {
    await upsertWeatherReading({
      locationId: location.id,
      date: d.date,
      temp_mean_c: d.temp_mean_c,
      rh_mean_pct: d.rh_mean_pct,
      source: "open-meteo",
    });
  }

  // Compute pressure for every date in the requested range that now has
  // a full 5-day trailing window. Pull the full history (cheap; one
  // location has at most a few hundred rows per season) and walk forward.
  const all = await listWeatherForLocation(location.id);
  all.sort((a, b) => a.date.localeCompare(b.date));

  let pressureRowsWritten = 0;
  for (let i = 4; i < all.length; i++) {
    const window = all.slice(i - 4, i + 1);
    const date = window[4].date;
    if (date < opts.startDate || date > opts.endDate) continue;
    const t5 = window.reduce((s, w) => s + w.temp_mean_c, 0) / 5;
    const rh5 = window.reduce((s, w) => s + w.rh_mean_pct, 0) / 5;
    const r = smithKerns(t5, rh5);
    await upsertPressureScore({
      locationId: location.id,
      date,
      temp_5day_avg_c: t5,
      rh_5day_avg_pct: rh5,
      temp_term: r.temp_term,
      rh_term: r.rh_term,
      smith_kerns_probability: r.probability,
      risk_band: r.risk_band,
    });
    pressureRowsWritten++;
  }

  return {
    locationId: location.id,
    daysFetched: days.length,
    pressureRowsWritten,
    startDate: opts.startDate,
    endDate: opts.endDate,
  };
}

// Pulls everything from WEATHER_BACKFILL_START up to yesterday for a new
// location. Idempotent.
export async function backfillLocation(location: Location): Promise<IngestSummary> {
  return ingestWeather(location, {
    startDate: WEATHER_BACKFILL_START,
    endDate: yesterdayUTC(),
  });
}

// Daily cron: just yesterday. Computing the pressure for yesterday only
// requires the previous 4 days, which the historical archive already has.
export async function ingestYesterday(location: Location): Promise<IngestSummary> {
  const y = yesterdayUTC();
  // Re-pull a small range so we always have the trailing window, even if
  // an earlier day was missed. Cheap (<5 rows from Open-Meteo).
  return ingestWeather(location, { startDate: addDays(y, -4), endDate: y });
}
