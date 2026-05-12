// Manual rebuild of the daily weather snapshot. Open to anyone (the
// dashboard is internal), but rate-limited so we don't pummel
// Open-Meteo / Airtable if a button is hammered.

import { NextResponse } from "next/server";
import { runDailyWeather } from "@/app/api/cron/daily-weather/route";
import { jsonRoute } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 min between manual refreshes
let lastRunAt = 0;

export async function POST() {
  const now = Date.now();
  const remaining = lastRunAt + MIN_INTERVAL_MS - now;
  if (remaining > 0) {
    return NextResponse.json(
      {
        error: `Snapshot was refreshed recently. Try again in ${Math.ceil(
          remaining / 1000
        )}s.`,
      },
      { status: 429 }
    );
  }
  lastRunAt = now;
  return jsonRoute(async () => runDailyWeather(), {
    context: "POST /api/snapshot/refresh",
  });
}
