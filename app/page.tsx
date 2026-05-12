import {
  listAllPhotos,
  listLocations,
  listPressureForLocation,
  type Location,
  type PressureScore,
} from "@/lib/airtable";
import { addDays, todayUTC } from "@/lib/dates";
import {
  computeForecastPressure,
  type ForecastPressureRow,
} from "@/lib/forecast-pressure";
import { pickPeak14, readSnapshot } from "@/lib/pressure-snapshot";
import type { RiskBand } from "@/lib/smith-kerns";
import { DashboardClient, type LocationStat } from "./DashboardClient";

export const dynamic = "force-dynamic";

async function statForLocationLive(
  loc: Location
): Promise<LocationStat | null> {
  // Fallback path used only when the daily snapshot blob hasn't been
  // written yet (e.g. fresh deploy before the first cron run).
  const since = addDays(todayUTC(), -7);
  const [actuals, forecast] = await Promise.all([
    listPressureForLocation(loc.id, { sinceDate: since }).catch(
      () => [] as PressureScore[]
    ),
    computeForecastPressure(loc, 14).catch(() => [] as ForecastPressureRow[]),
  ]);
  const latest = actuals[actuals.length - 1] ?? null;
  const peak = pickPeak14(forecast);
  return {
    today: latest
      ? {
          date: latest.date,
          probability: latest.smith_kerns_probability,
          band: latest.risk_band as RiskBand,
        }
      : null,
    peak14: peak
      ? {
          date: peak.date,
          probability: peak.probability,
          band: peak.risk_band,
        }
      : null,
  };
}

export default async function HomePage() {
  let locations: Location[] = [];
  let allPhotos: Awaited<ReturnType<typeof listAllPhotos>> = [];
  let loadError: string | null = null;
  try {
    [locations, allPhotos] = await Promise.all([
      listLocations(),
      listAllPhotos(),
    ]);
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  const photoCounts: Record<string, number> = {};
  const lastPhotoDate: Record<string, string> = {};
  for (const p of allPhotos) {
    photoCounts[p.locationId] = (photoCounts[p.locationId] ?? 0) + 1;
    const prev = lastPhotoDate[p.locationId];
    if (!prev || p.photo_date > prev) lastPhotoDate[p.locationId] = p.photo_date;
  }

  // Read the daily snapshot — covers every active location with one
  // small fetch from Vercel Blob (cached for 60s by Next's data cache).
  // The cron writes this blob at 04:00 UTC every day; the dashboard never
  // calls Open-Meteo from this page.
  const snapshot = await readSnapshot();

  const active = locations.filter((l) => l.active);
  const locationStats: Record<string, LocationStat> = {};
  const missingFromSnapshot: Location[] = [];
  for (const loc of active) {
    const s = snapshot?.locations[loc.id];
    if (s) {
      locationStats[loc.id] = {
        today: s.today_score
          ? {
              date: s.today_score.date,
              probability: s.today_score.smith_kerns_probability,
              band: s.today_score.risk_band as RiskBand,
            }
          : null,
        peak14: s.peak14
          ? {
              date: s.peak14.date,
              probability: s.peak14.probability,
              band: s.peak14.risk_band,
            }
          : null,
      };
    } else {
      missingFromSnapshot.push(loc);
    }
  }
  // For any location not covered by the snapshot (brand new locations or
  // first deploy), fall back to live computation just for that one. Once
  // the next cron run completes, this branch is skipped.
  if (missingFromSnapshot.length > 0) {
    const fallback = await Promise.all(
      missingFromSnapshot.map((l) =>
        statForLocationLive(l).catch(() => null)
      )
    );
    missingFromSnapshot.forEach((l, i) => {
      const s = fallback[i];
      if (s) locationStats[l.id] = s;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Dollar spot pressure
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Smith-Kerns logistic-regression probability based on the trailing
            5-day mean temperature and relative humidity.
          </p>
        </div>
        {snapshot && (
          <div className="text-xs text-stone-500">
            Weather snapshot updated{" "}
            <strong className="text-stone-700">
              {fmtSnapshotTime(snapshot.generated_at_iso)}
            </strong>
          </div>
        )}
      </div>
      {loadError && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <div className="font-semibold">Airtable load failed</div>
          <div className="mt-1 break-words font-mono text-xs">{loadError}</div>
          <div className="mt-2 text-xs text-red-700">
            Check that <code>AIRTABLE_API_KEY</code> and{" "}
            <code>AIRTABLE_BASE_ID</code> are set on the deploy and that the
            Personal Access Token has access to this base with{" "}
            <code>data.records:read</code>.
          </div>
        </div>
      )}
      <DashboardClient
        locations={locations}
        photoCounts={photoCounts}
        lastPhotoDate={lastPhotoDate}
        locationStats={locationStats}
        snapshotGeneratedAt={snapshot?.generated_at_iso ?? null}
      />
    </div>
  );
}

function fmtSnapshotTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate();
  if (sameDay) {
    return `today at ${d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
