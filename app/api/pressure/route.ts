import { NextResponse } from "next/server";
import { getLocation, listPressureForLocation } from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";
import { addDays, todayUTC, yesterdayUTC } from "@/lib/dates";
import { computeForecastPressure } from "@/lib/forecast-pressure";
import { ingestWeather } from "@/lib/weather-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_FORECAST_DAYS = 14;
const MAX_FORECAST_DAYS = 16;
// Cap auto-catch-up so a long gap doesn't stall the dashboard. Anything
// bigger than this means the user should run the manual backfill button.
const MAX_AUTO_CATCH_UP_DAYS = 30;

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
      // If the latest pressure row is older than yesterday, fetch the gap
      // from Open-Meteo and recompute Smith-Kerns for those days *before*
      // returning. This means the user always sees current data when they
      // visit, without waiting on the daily cron.
      const yesterday = yesterdayUTC();
      const latestStored = actuals[actuals.length - 1]?.date;
      let caughtUpDays = 0;
      let catchUpError: string | null = null;

      if (loc && (!latestStored || latestStored < yesterday)) {
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
            // Re-read so the response reflects the new rows.
            actuals = await listPressureForLocation(locationId, {
              sinceDate: since,
            });
          } catch (e) {
            catchUpError = e instanceof Error ? e.message : String(e);
            console.warn(`pressure catch-up failed for ${locationId}`, e);
          }
        }
      }

      const forecast =
        loc && forecastDays > 0
          ? await computeForecastPressure(loc, forecastDays).catch(() => [])
          : [];

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
      };
    },
    { context: `GET /api/pressure?locationId=${locationId}` }
  );
}
