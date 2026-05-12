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
import type { RiskBand } from "@/lib/smith-kerns";
import { DashboardClient, type LocationStat } from "./DashboardClient";

export const dynamic = "force-dynamic";

async function statForLocation(loc: Location): Promise<LocationStat | null> {
  // Pull the last few days of actual scores so we always pick the most
  // recent one even if today's catch-up hasn't run yet, plus the 14-day
  // forecast peak.
  const since = addDays(todayUTC(), -7);
  const [actuals, forecast] = await Promise.all([
    listPressureForLocation(loc.id, { sinceDate: since }).catch(
      () => [] as PressureScore[]
    ),
    computeForecastPressure(loc, 14).catch(() => [] as ForecastPressureRow[]),
  ]);
  const latest = actuals[actuals.length - 1] ?? null;
  let peak: { date: string; probability: number; band: RiskBand } | null = null;
  for (const row of forecast) {
    if (!peak || row.smith_kerns_probability > peak.probability) {
      peak = {
        date: row.date,
        probability: row.smith_kerns_probability,
        band: row.risk_band,
      };
    }
  }
  return {
    today: latest
      ? {
          date: latest.date,
          probability: latest.smith_kerns_probability,
          band: latest.risk_band,
        }
      : null,
    peak14: peak,
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

  const active = locations.filter((l) => l.active);
  const stats = await Promise.all(
    active.map((l) => statForLocation(l).catch(() => null))
  );
  const locationStats: Record<string, LocationStat> = {};
  active.forEach((l, i) => {
    const s = stats[i];
    if (s) locationStats[l.id] = s;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Dollar spot pressure
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          Smith-Kerns logistic-regression probability based on the trailing
          5-day mean temperature and relative humidity.
        </p>
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
      />
    </div>
  );
}
