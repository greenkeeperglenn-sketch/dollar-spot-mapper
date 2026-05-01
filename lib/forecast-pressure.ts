// Computes Smith-Kerns probability for forecast days.
//
// The trailing 5-day window for a forecast day mixes past actuals
// (from the WeatherReadings table) with future forecasts (from
// Open-Meteo's forecast API). We seed the window with the last few
// actuals, then walk through each forecast day and compute the mean.

import type { Location } from "./airtable";
import { listWeatherForLocation } from "./airtable";
import { addDays, todayUTC } from "./dates";
import { fetchForecast } from "./open-meteo";
import { bandFor, smithKerns } from "./smith-kerns";

export type ForecastPressureRow = {
  date: string;
  temp_5day_avg_c: number;
  rh_5day_avg_pct: number;
  temp_term: number;
  rh_term: number;
  smith_kerns_probability: number;
  risk_band: ReturnType<typeof bandFor>;
  is_forecast: true;
};

export async function computeForecastPressure(
  location: Location,
  forecastDays: number
): Promise<ForecastPressureRow[]> {
  const days = Math.max(1, Math.min(16, Math.round(forecastDays)));
  const today = todayUTC();
  const seedFrom = addDays(today, -5); // need 4 prior days + today

  const [actualsAll, forecast] = await Promise.all([
    listWeatherForLocation(location.id, { sinceDate: seedFrom }),
    fetchForecast({
      latitude: location.latitude,
      longitude: location.longitude,
      forecastDays: days,
    }),
  ]);

  // Build a single ordered series, oldest -> newest, that runs from the
  // earliest seed actual through the last forecast day. Forecast days
  // override actuals for any overlapping date (Open-Meteo's forecast
  // includes today as day 0 in some configs; we use forecast_days only,
  // so this rarely overlaps, but we handle it for robustness).
  type Daily = { date: string; temp_mean_c: number; rh_mean_pct: number };
  const byDate = new Map<string, Daily>();
  for (const a of actualsAll) {
    byDate.set(a.date, {
      date: a.date,
      temp_mean_c: a.temp_mean_c,
      rh_mean_pct: a.rh_mean_pct,
    });
  }
  for (const f of forecast) byDate.set(f.date, f);

  const ordered = Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const forecastDateSet = new Set(forecast.map((f) => f.date));

  // For each forecast date, look back 4 days plus include itself. If we
  // have a full 5-day window, compute Smith-Kerns and emit a row.
  const rows: ForecastPressureRow[] = [];
  for (let i = 4; i < ordered.length; i++) {
    const date = ordered[i].date;
    if (!forecastDateSet.has(date)) continue; // only emit forecast rows
    const window = ordered.slice(i - 4, i + 1);
    if (window.length < 5) continue;
    const t5 = window.reduce((s, w) => s + w.temp_mean_c, 0) / 5;
    const rh5 = window.reduce((s, w) => s + w.rh_mean_pct, 0) / 5;
    const r = smithKerns(t5, rh5);
    rows.push({
      date,
      temp_5day_avg_c: t5,
      rh_5day_avg_pct: rh5,
      temp_term: r.temp_term,
      rh_term: r.rh_term,
      smith_kerns_probability: r.probability,
      risk_band: r.risk_band,
      is_forecast: true,
    });
  }

  return rows;
}
