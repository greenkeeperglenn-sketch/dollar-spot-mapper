import { NextResponse } from "next/server";
import {
  listActiveLocations,
  listPressureForLocation,
  type Location,
} from "@/lib/airtable";
import { addDays, todayUTC } from "@/lib/dates";
import {
  computeForecastPressure,
  type ForecastPressureRow,
} from "@/lib/forecast-pressure";
import {
  pickPeak14,
  writeSnapshot,
  type LocationSnapshot,
  type PressureSnapshot,
} from "@/lib/pressure-snapshot";
import { ingestYesterday } from "@/lib/weather-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * Pulls yesterday's weather + computes the 14-day forecast for every
 * active location, persists the actuals into Airtable, and writes a
 * single combined snapshot to Vercel Blob that the dashboard reads
 * from. Exposed so the manual /api/snapshot/refresh route can call the
 * exact same code path.
 */
export async function runDailyWeather(): Promise<{
  summaries: Array<{
    locationId: string;
    locationName: string;
    daysFetched?: number;
    pressureRowsWritten?: number;
    forecastDays?: number;
    error?: string;
  }>;
  snapshot_url: string | null;
  generated_at_iso: string;
}> {
  const locations = await listActiveLocations();
  const generatedAt = new Date().toISOString();
  const summaries: Array<{
    locationId: string;
    locationName: string;
    daysFetched?: number;
    pressureRowsWritten?: number;
    forecastDays?: number;
    error?: string;
  }> = [];
  const snapshotLocations: Record<string, LocationSnapshot> = {};

  for (const loc of locations) {
    try {
      const ingestSummary = await ingestYesterday(loc);
      const snapshot = await buildLocationSnapshot(loc);
      snapshotLocations[loc.id] = snapshot;
      summaries.push({
        locationId: loc.id,
        locationName: loc.name,
        daysFetched: ingestSummary.daysFetched,
        pressureRowsWritten: ingestSummary.pressureRowsWritten,
        forecastDays: snapshot.forecast.length,
      });
    } catch (err) {
      console.error(`weather refresh failed for ${loc.id}`, err);
      summaries.push({
        locationId: loc.id,
        locationName: loc.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let snapshotUrl: string | null = null;
  try {
    const snapshot: PressureSnapshot = {
      version: 1,
      generated_at_iso: generatedAt,
      locations: snapshotLocations,
    };
    const written = await writeSnapshot(snapshot);
    snapshotUrl = written.url;
  } catch (err) {
    console.error("Failed to write pressure snapshot to Vercel Blob", err);
  }

  return {
    summaries,
    snapshot_url: snapshotUrl,
    generated_at_iso: generatedAt,
  };
}

/**
 * Assemble the per-location snapshot block: the most recent stored
 * PressureScore (today/yesterday) and the 14-day forecast peak.
 */
async function buildLocationSnapshot(loc: Location): Promise<LocationSnapshot> {
  // Pull a week of recent actuals so we always pick up today's row even
  // if the cron has been missed for a day.
  const since = addDays(todayUTC(), -7);
  let forecast: ForecastPressureRow[] = [];
  try {
    forecast = await computeForecastPressure(loc, 14);
  } catch (e) {
    console.warn(`forecast computation failed for ${loc.id}`, e);
  }
  let recent = [] as Awaited<ReturnType<typeof listPressureForLocation>>;
  try {
    recent = await listPressureForLocation(loc.id, { sinceDate: since });
  } catch (e) {
    console.warn(`recent pressure read failed for ${loc.id}`, e);
  }
  const todayScore = recent[recent.length - 1] ?? null;
  return {
    today_score: todayScore,
    peak14: pickPeak14(forecast),
    forecast,
  };
}

// Vercel Cron always uses GET. Keep POST too for manual curl tests.
export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  return NextResponse.json(await runDailyWeather());
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  return NextResponse.json(await runDailyWeather());
}
