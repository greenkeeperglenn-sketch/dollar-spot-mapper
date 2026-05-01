import { NextResponse } from "next/server";
import { getLocation, listPressureForLocation } from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";
import { addDays, todayUTC } from "@/lib/dates";
import { computeForecastPressure } from "@/lib/forecast-pressure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_FORECAST_DAYS = 14;
const MAX_FORECAST_DAYS = 16;

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
      const actuals = await listPressureForLocation(locationId, {
        sinceDate: since,
      });

      let forecast: Awaited<ReturnType<typeof computeForecastPressure>> = [];
      if (forecastDays > 0) {
        const loc = await getLocation(locationId);
        if (loc) {
          forecast = await computeForecastPressure(loc, forecastDays);
        }
      }

      return {
        scores: actuals.map((s) => ({ ...s, is_forecast: false as const })),
        forecast,
        today: todayUTC(),
      };
    },
    { context: `GET /api/pressure?locationId=${locationId}` }
  );
}
