import { NextResponse } from "next/server";
import { getLocation, listPressureForLocation } from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";
import { addDays, todayUTC, yesterdayUTC } from "@/lib/dates";
import {
  computeForecastPressure,
  type ForecastPressureRow,
} from "@/lib/forecast-pressure";
import { readSnapshot } from "@/lib/pressure-snapshot";
import { ingestWeather } from "@/lib/weather-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_FORECAST_DAYS = 14;
const MAX_FORECAST_DAYS = 16;
// Cap auto-catch-up so a long gap doesn't stall the dashboard. Anything
// bigger than this means the user should run the manual backfill button.
const MAX_AUTO_CATCH_UP_DAYS = 30;
// Don't run catch-up more than once per location per CATCH_UP_TTL_MS. The
// daily cron writes yesterday's reading, and rapid dashboard reloads /
// range-switches otherwise re-hit Open-Meteo + Airtable for nothing.
const CATCH_UP_TTL_MS = 30 * 60 * 1000;
const recentlyCaughtUp = new Map<string, number>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const locationId = url.searchParams.get("locationId");
  const daysParam = url.searchParams.get("days");
  const forecastParam = url.searchParams.get("forecastDays");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }
  const days = daysParam ? Math.max(1, Math.min(365, Number(daysParam))) : 30;
  const forecastDays = forecastParam
    ? Math.max(0, Math.min(MAX_FORECAST_DAYS, Number(forecastParam)))
    : DEFAULT_FORECAST_DAYS;
  const since = addDays(todayUTC(), -days);

  return jsonRoute(
    async () => {
      const loc = await getLocation(locationId);
      let actuals = await listPressureForLocation(locationId, {
        sinceDate: since,
      });

      // --- Self-healing catch-up --------------------------------------
      // The daily cron should have written yesterday's row; this only
      // fires if (a) the cron missed and (b) we haven't already tried
      // to catch up for this location in the last 30 minutes.
      const yesterday = yesterdayUTC();
      const latestStored = actuals[actuals.length - 1]?.date;
      let caughtUpDays = 0;
      let catchUpError: string | null = null;

      const lastRun = recentlyCaughtUp.get(locationId) ?? 0;
      const skipCatchUp = Date.now() - lastRun < CATCH_UP_TTL_MS;
      if (
        loc &&
        !skipCatchUp &&
        (!latestStored || latestStored < yesterday)
      ) {
        const desiredStart = latestStored
          ? addDays(latestStored, 1)
          : addDays(yesterday, -MAX_AUTO_CATCH_UP_DAYS);
        const cap = addDays(yesterday, -MAX_AUTO_CATCH_UP_DAYS);
        const start = desiredStart < cap ? cap : desiredStart;
        if (start <= yesterday) {
          try {
            const summary = await ingestWeather(loc, {
              startDate: start,
              endDate: yesterday,
            });
            caughtUpDays = summary.pressureRowsWritten;
            recentlyCaughtUp.set(locationId, Date.now());
            actuals = await listPressureForLocation(locationId, {
              sinceDate: since,
            });
          } catch (e) {
            catchUpError = e instanceof Error ? e.message : String(e);
            console.warn(`pressure catch-up failed for ${locationId}`, e);
          }
        }
      }

      // --- Forecast ---------------------------------------------------
      // Prefer the daily snapshot — it's a single cached blob, no
      // Open-Meteo call from this route. Fall back to live computation
      // only if the snapshot is missing this location (fresh deploy or
      // brand-new location).
      let forecast: ForecastPressureRow[] = [];
      let snapshotGeneratedAt: string | null = null;
      if (forecastDays > 0) {
        try {
          const snapshot = await readSnapshot();
          snapshotGeneratedAt = snapshot?.generated_at_iso ?? null;
          const locSnap = snapshot?.locations[locationId];
          if (locSnap) {
            forecast = locSnap.forecast.slice(0, forecastDays);
          } else if (loc) {
            forecast = await computeForecastPressure(loc, forecastDays).catch(
              () => []
            );
          }
        } catch (e) {
          console.warn(`forecast snapshot read failed`, e);
          if (loc) {
            forecast = await computeForecastPressure(loc, forecastDays).catch(
              () => []
            );
          }
        }
      }

      return {
        scores: actuals.map((s) => ({ ...s, is_forecast: false as const })),
        forecast,
        today: todayUTC(),
        // Freshness signal for the UI:
        latest_actual_date:
          actuals[actuals.length - 1]?.date ?? null,
        caught_up_days: caughtUpDays,
        catch_up_error: catchUpError,
        synced_at_iso: new Date().toISOString(),
        snapshot_generated_at: snapshotGeneratedAt,
      };
    },
    { context: `GET /api/pressure?locationId=${locationId}` }
  );
}
