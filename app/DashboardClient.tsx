"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Location, PhotoAssessment, PressureScore } from "@/lib/airtable";
import type { ForecastPressureRow } from "@/lib/forecast-pressure";
import { HeroSummary, type Range } from "@/components/HeroSummary";
import { PhotoTrendPanels } from "@/components/PhotoTrendPanels";
import { PressurePanels } from "@/components/PressurePanels";
import { StoredAssessmentReview } from "@/components/StoredAssessmentReview";

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: string; where?: string };
    if (j.error) return j.where ? `${j.error} (${j.where})` : j.error;
  } catch {
    /* fallthrough */
  }
  return text.slice(0, 500) || `HTTP ${res.status}`;
}

function rangeToDays(range: Range): number {
  if (range === "30d") return 30;
  if (range === "90d") return 90;
  // season: days since 1 March of the current year (or the most recent past
  // 1 March if today is in Jan/Feb).
  const now = new Date();
  let year = now.getUTCFullYear();
  const seasonStart = new Date(Date.UTC(year, 2, 1));
  if (now < seasonStart) {
    year -= 1;
    seasonStart.setUTCFullYear(year);
  }
  const days = Math.ceil(
    (now.getTime() - seasonStart.getTime()) / 86_400_000
  );
  return Math.max(30, Math.min(365, days));
}

export function DashboardClient({ locations }: { locations: Location[] }) {
  const active = useMemo(() => locations.filter((l) => l.active), [locations]);
  const [selectedId, setSelectedId] = useState<string>(active[0]?.id ?? "");
  const [range, setRange] = useState<Range>("30d");
  const [scores, setScores] = useState<PressureScore[] | null>(null);
  const [forecast, setForecast] = useState<ForecastPressureRow[]>([]);
  const [photos, setPhotos] = useState<PhotoAssessment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [caughtUpDays, setCaughtUpDays] = useState(0);
  const [catchUpError, setCatchUpError] = useState<string | null>(null);

  // Reset selection + range when location changes.
  useEffect(() => {
    setViewingDate(null);
  }, [selectedId]);

  const photosByDate = useMemo(() => {
    const m = new Map<string, PhotoAssessment[]>();
    for (const p of photos ?? []) {
      const list = m.get(p.photo_date) ?? [];
      list.push(p);
      m.set(p.photo_date, list);
    }
    return m;
  }, [photos]);

  const photoCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const [d, list] of photosByDate) m.set(d, list.length);
    return m;
  }, [photosByDate]);

  const viewingPhotos = viewingDate
    ? photosByDate.get(viewingDate) ?? []
    : [];

  useEffect(() => {
    if (!selectedId) {
      setScores(null);
      setForecast([]);
      setPhotos(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const days = rangeToDays(range);

    Promise.all([
      fetch(
        `/api/pressure?locationId=${selectedId}&days=${days}&forecastDays=14`,
        { cache: "no-store" }
      ).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r));
        return (await r.json()) as {
          scores: PressureScore[];
          forecast: ForecastPressureRow[];
          synced_at_iso?: string;
          caught_up_days?: number;
          catch_up_error?: string | null;
        };
      }),
      fetch(`/api/photos?locationId=${selectedId}`, {
        cache: "no-store",
      }).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r));
        return (await r.json()) as { photos: PhotoAssessment[] };
      }),
    ])
      .then(([p, ph]) => {
        if (cancelled) return;
        setScores(p.scores);
        setForecast(p.forecast ?? []);
        setPhotos(ph.photos);
        setSyncedAt(p.synced_at_iso ?? null);
        setCaughtUpDays(p.caught_up_days ?? 0);
        setCatchUpError(p.catch_up_error ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, range]);

  if (active.length === 0) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-6 text-center text-sm text-stone-600">
        No active locations.{" "}
        <Link href="/locations" className="underline">
          Add one
        </Link>{" "}
        to get started.
      </div>
    );
  }

  const selectedLocation = active.find((l) => l.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-stone-700">Location</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded border border-stone-300 bg-white px-2 py-1 text-sm"
        >
          {active.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {selectedId && (
          <Link
            href={`/locations/${selectedId}`}
            className="ml-auto text-sm text-stone-600 underline"
          >
            View full history
          </Link>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {loading && <div className="text-sm text-stone-500">Loading…</div>}

      {scores && scores.length === 0 && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          No pressure scores yet for this location. The first score appears
          once 5 days of weather have been backfilled — try clicking{" "}
          <Link href="/locations" className="underline">
            Fetch weather now
          </Link>
          .
        </div>
      )}

      {scores && scores.length > 0 && (
        <HeroSummary
          locationName={selectedLocation?.name ?? "Location"}
          locationLogoUrl={selectedLocation?.logo_url ?? null}
          scores={scores}
          forecast={forecast}
          photos={photos ?? []}
          range={range}
          onRangeChange={setRange}
          onSelectPhotoDate={(d) =>
            setViewingDate((prev) => (prev === d ? null : d))
          }
          syncedAtIso={syncedAt}
          caughtUpDays={caughtUpDays}
          catchUpError={catchUpError}
        />
      )}

      {viewingDate && viewingPhotos.length > 0 && (
        <section className="space-y-3 rounded-lg border-2 border-blue-300 bg-blue-50/40 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-900">
              Photo{viewingPhotos.length > 1 ? "s" : ""} from {viewingDate}
            </h2>
            <button
              onClick={() => setViewingDate(null)}
              className="rounded border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-50"
            >
              Close
            </button>
          </div>
          {viewingPhotos.map((p) => (
            <StoredAssessmentReview key={p.id} assessment={p} />
          ))}
        </section>
      )}

      {scores && scores.length > 0 && (
        <details className="rounded-lg border border-stone-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Show more detail (decomposition, raw inputs, photo trends)
          </summary>
          <div className="space-y-6 border-t border-stone-200 p-4">
            <PressurePanels
              scores={scores}
              forecast={forecast}
              photosByDate={photoCountByDate}
              onSelectPhotoDate={(d) =>
                setViewingDate((prev) => (prev === d ? null : d))
              }
              locationName={selectedLocation?.name ?? "Location"}
              locationLogoUrl={selectedLocation?.logo_url ?? null}
              photos={photos ?? []}
              syncedAtIso={syncedAt}
              caughtUpDays={caughtUpDays}
              catchUpError={catchUpError}
            />
            {photos && (
              <PhotoTrendPanels
                photos={photos}
                onSelectDate={(d) =>
                  setViewingDate((prev) => (prev === d ? null : d))
                }
              />
            )}
          </div>
        </details>
      )}
    </div>
  );
}
