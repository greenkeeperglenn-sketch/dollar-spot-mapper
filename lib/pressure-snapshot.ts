// Daily weather snapshot — written once a day by the cron, read by every
// dashboard render. Lives as a single JSON blob in Vercel Blob storage so
// the public Open-Meteo API only gets hit from the cron, not from every
// page load.

import { list, put } from "@vercel/blob";
import type { PressureScore } from "./airtable";
import type { ForecastPressureRow } from "./forecast-pressure";
import type { RiskBand } from "./smith-kerns";

const SNAPSHOT_PATHNAME = "pressure-snapshot/latest.json";

export type LocationSnapshot = {
  /** Most recent stored PressureScore for the location (yesterday's
   *  reading after the cron runs). Null if the location has no actuals
   *  yet — e.g. brand new locations whose backfill hasn't completed. */
  today_score: PressureScore | null;
  /** Highest probability across the 14-day forecast and the date it falls
   *  on. Null if the forecast couldn't be computed. */
  peak14: {
    date: string;
    probability: number;
    risk_band: RiskBand;
  } | null;
  /** Full 14-day forecast for the location, ready to chart. */
  forecast: ForecastPressureRow[];
};

export type PressureSnapshot = {
  version: 1;
  generated_at_iso: string;
  /** Keyed by Airtable location record id. */
  locations: Record<string, LocationSnapshot>;
};

export async function writeSnapshot(snapshot: PressureSnapshot): Promise<{
  url: string;
}> {
  const body = JSON.stringify(snapshot);
  const result = await put(SNAPSHOT_PATHNAME, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60, // a minute is enough; the cron only writes once a day
  });
  return { url: result.url };
}

/**
 * Look up the canonical URL of the snapshot in the Vercel Blob store and
 * fetch its contents. Returns null if no snapshot has been written yet
 * (first deploy before the cron runs).
 */
export async function readSnapshot(): Promise<PressureSnapshot | null> {
  let snapshotUrl: string | null = null;
  try {
    const listed = await list({ prefix: "pressure-snapshot/", limit: 5 });
    const match = listed.blobs.find(
      (b) => b.pathname === SNAPSHOT_PATHNAME
    );
    snapshotUrl = match?.url ?? null;
  } catch (e) {
    console.warn("readSnapshot: list failed", e);
    return null;
  }
  if (!snapshotUrl) return null;
  try {
    const res = await fetch(snapshotUrl, {
      // Re-fetch occasionally; the cron only writes once a day so this
      // can sit in Next's data cache for a long stretch without issue.
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as PressureSnapshot;
    if (!json || typeof json !== "object" || !json.locations) return null;
    return json;
  } catch (e) {
    console.warn("readSnapshot: fetch failed", e);
    return null;
  }
}

export function pickPeak14(
  forecast: ForecastPressureRow[]
): LocationSnapshot["peak14"] {
  if (forecast.length === 0) return null;
  let best = forecast[0];
  for (const f of forecast) {
    if (f.smith_kerns_probability > best.smith_kerns_probability) best = f;
  }
  return {
    date: best.date,
    probability: best.smith_kerns_probability,
    risk_band: best.risk_band,
  };
}
