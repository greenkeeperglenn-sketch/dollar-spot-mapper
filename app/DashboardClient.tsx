"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Location, PhotoAssessment, PressureScore } from "@/lib/airtable";
import type { ForecastPressureRow } from "@/lib/forecast-pressure";
import type { RiskBand } from "@/lib/smith-kerns";
import { bandPalette, neutralPalette } from "@/lib/risk-palette";
import { HeroSummary, type Range } from "@/components/HeroSummary";
import { PhaseGrid } from "@/components/PhaseGrid";
import { PhotoStrip, compareSites } from "@/components/PhotoStrip";
import { PhotoTrendPanels } from "@/components/PhotoTrendPanels";
import { PressurePanels } from "@/components/PressurePanels";
import { StoredAssessmentReview } from "@/components/StoredAssessmentReview";

export type LocationStat = {
  today: { date: string; probability: number; band: RiskBand } | null;
  peak14: { date: string; probability: number; band: RiskBand } | null;
};

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

export function DashboardClient({
  locations,
  photoCounts = {},
  lastPhotoDate = {},
  locationStats = {},
  snapshotGeneratedAt = null,
}: {
  locations: Location[];
  photoCounts?: Record<string, number>;
  lastPhotoDate?: Record<string, string>;
  locationStats?: Record<string, LocationStat>;
  snapshotGeneratedAt?: string | null;
}) {
  const active = useMemo(() => {
    const list = locations.filter((l) => l.active);
    // Order by photo count descending, ties broken by name.
    return list.sort((a, b) => {
      const aCount = photoCounts[a.id] ?? 0;
      const bCount = photoCounts[b.id] ?? 0;
      if (aCount !== bCount) return bCount - aCount;
      return a.name.localeCompare(b.name);
    });
  }, [locations, photoCounts]);
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

  const selectedLocation = active.find((l) => l.id === selectedId);
  const siteOrder = selectedLocation?.sites ?? [];

  const viewingPhotos = useMemo(() => {
    const list = viewingDate ? photosByDate.get(viewingDate) ?? [] : [];
    return [...list].sort((a, b) =>
      compareSites(a.quadrat_label, b.quadrat_label, siteOrder)
    );
  }, [viewingDate, photosByDate, siteOrder]);

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

  return (
    <div className="space-y-6">
      <SnapshotBar generatedAtIso={snapshotGeneratedAt} />
      <LocationStrip
        locations={active}
        selectedId={selectedId}
        photoCounts={photoCounts}
        lastPhotoDate={lastPhotoDate}
        locationStats={locationStats}
        onSelect={setSelectedId}
      />
      <div className="flex flex-wrap items-center gap-3">
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

      {photos && (
        <PhotoStrip
          photos={photos}
          scores={scores ?? []}
          siteOrder={siteOrder}
          onSelect={(d) =>
            setViewingDate((prev) => (prev === d ? null : d))
          }
          selectedDate={viewingDate}
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
            <PhaseGrid
              scores={scores}
              forecast={forecast}
              locationName={selectedLocation?.name ?? "Location"}
              locationLogoUrl={selectedLocation?.logo_url ?? null}
              photos={photos ?? []}
            />
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

function LocationStrip({
  locations,
  selectedId,
  photoCounts,
  lastPhotoDate,
  locationStats,
  onSelect,
}: {
  locations: Location[];
  selectedId: string;
  photoCounts: Record<string, number>;
  lastPhotoDate: Record<string, string>;
  locationStats: Record<string, LocationStat>;
  onSelect: (id: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    function update() {
      const e = scrollerRef.current;
      if (!e) return;
      setCanScrollLeft(e.scrollLeft > 4);
      setCanScrollRight(e.scrollLeft + e.clientWidth < e.scrollWidth - 4);
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [locations.length]);

  function scrollByDir(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  }

  if (locations.length === 0) return null;
  return (
    <nav aria-label="Locations" className="relative">
      <div
        ref={scrollerRef}
        className="overflow-x-auto pb-2"
      >
        <div className="mx-auto flex w-max gap-3 px-10 pt-2">
          {locations.map((loc) => {
            const count = photoCounts[loc.id] ?? 0;
            const stat = locationStats[loc.id];
            const last = lastPhotoDate[loc.id] ?? null;
            const daysSince = last ? daysBetween(last, todayIsoUTC()) : null;
            const isSelected = loc.id === selectedId;
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => onSelect(loc.id)}
                className={`group relative flex shrink-0 flex-col items-center gap-2 rounded-2xl border-2 bg-white p-3 transition-all duration-200 ease-out ${
                  isSelected
                    ? "border-stone-900 shadow-lg ring-4 ring-stone-200"
                    : "border-stone-200 hover:scale-105 hover:border-stone-400 hover:shadow-md hover:ring-4 hover:ring-blue-100"
                }`}
                style={{ minWidth: 144 }}
                title={`${loc.name} — ${count} photo${count === 1 ? "" : "s"}${
                  stat?.today
                    ? ` · latest ${pct(stat.today.probability)} (${stat.today.band})`
                    : ""
                }${
                  stat?.peak14
                    ? ` · 14d peak ${pct(stat.peak14.probability)} (${stat.peak14.band})`
                    : ""
                }`}
              >
                <div className="flex h-16 w-24 items-center justify-center">
                  {loc.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={loc.logo_url}
                      alt={loc.name}
                      className={`h-full w-full object-contain transition-transform duration-200 ease-out ${
                        isSelected ? "" : "group-hover:scale-110"
                      }`}
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-full bg-stone-100 text-xl font-bold text-stone-600 transition-transform duration-200 ease-out ${
                        isSelected ? "" : "group-hover:scale-110"
                      }`}
                    >
                      {loc.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div
                  className={`flex h-8 w-full items-start justify-center overflow-hidden px-1 text-center text-xs font-semibold leading-tight ${
                    isSelected ? "text-stone-900" : "text-stone-700"
                  }`}
                >
                  <span className="line-clamp-2">{loc.name}</span>
                </div>
                <div className="flex w-full items-stretch gap-1">
                  <PressurePill
                    label="Latest"
                    value={stat?.today?.probability ?? null}
                    band={stat?.today?.band ?? null}
                    date={stat?.today?.date ?? null}
                  />
                  <PressurePill
                    label="14d high"
                    value={stat?.peak14?.probability ?? null}
                    band={stat?.peak14?.band ?? null}
                    date={stat?.peak14?.date ?? null}
                  />
                </div>
                <FreshnessPill daysSince={daysSince} count={count} />
              </button>
            );
          })}
        </div>
      </div>
      {canScrollLeft && (
        <ScrollButton
          direction="left"
          onClick={() => scrollByDir(-1)}
        />
      )}
      {canScrollRight && (
        <ScrollButton
          direction="right"
          onClick={() => scrollByDir(1)}
        />
      )}
    </nav>
  );
}

function ScrollButton({
  direction,
  onClick,
}: {
  direction: "left" | "right";
  onClick: () => void;
}) {
  const isLeft = direction === "left";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isLeft ? "Scroll locations left" : "Scroll locations right"}
      className={`absolute top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white/95 text-lg text-stone-700 shadow-md backdrop-blur transition-all hover:scale-110 hover:bg-white hover:text-stone-900 hover:shadow-lg ${
        isLeft ? "left-1" : "right-1"
      }`}
    >
      {isLeft ? "‹" : "›"}
    </button>
  );
}

function PressurePill({
  label,
  value,
  band,
  date,
}: {
  label: string;
  value: number | null;
  band: RiskBand | null;
  date: string | null;
}) {
  const palette = value != null && band ? bandPalette(band) : neutralPalette();
  return (
    <div
      className="flex flex-1 flex-col items-center rounded-md border px-1 py-1 leading-tight"
      style={{
        background: palette.bg,
        borderColor: palette.border,
        color: palette.fg,
      }}
    >
      <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide opacity-80">
        {label}
      </span>
      <span className="text-sm font-bold tabular-nums">
        {value != null ? pct(value) : "—"}
      </span>
      <span className="whitespace-nowrap text-[9px] tabular-nums opacity-70">
        {date ? fmtShortDate(date) : "—"}
      </span>
    </div>
  );
}

function FreshnessPill({
  daysSince,
  count,
}: {
  daysSince: number | null;
  count: number;
}) {
  let palette = neutralPalette();
  let text: string;
  if (daysSince == null) {
    text = "no photos";
  } else if (daysSince <= 0) {
    text = "today";
    palette = bandPalette("Low");
  } else if (daysSince === 1) {
    text = "1 day ago";
    palette = bandPalette("Low");
  } else if (daysSince <= 6) {
    text = `${daysSince} days ago`;
    palette = bandPalette("Low");
  } else if (daysSince <= 13) {
    text = `${daysSince} days ago`;
    palette = bandPalette("Moderate");
  } else {
    text = `${daysSince} days ago`;
    palette = bandPalette("High");
  }
  return (
    <div
      className="flex w-full flex-col items-center rounded-md border px-1 py-0.5 leading-tight"
      style={{
        background: palette.bg,
        borderColor: palette.border,
        color: palette.fg,
      }}
      title={
        daysSince == null
          ? "No photos yet"
          : `Last photo ${daysSince} day${daysSince === 1 ? "" : "s"} ago · target every 7 days`
      }
    >
      <span className="whitespace-nowrap text-[10px] font-bold tabular-nums">
        {text}
      </span>
      <span className="text-[9px] tabular-nums opacity-70">
        {count} photo{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function fmtShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function todayIsoUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function SnapshotBar({ generatedAtIso }: { generatedAtIso: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/snapshot/refresh", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        generated_at_iso?: string;
      };
      if (!res.ok) {
        setMessage({
          kind: "error",
          text: data.error ?? `HTTP ${res.status}`,
        });
      } else {
        setMessage({
          kind: "ok",
          text: "Weather refreshed. Reloading…",
        });
        // Trigger a server-component re-render so the dashboard reads
        // the fresh snapshot.
        router.refresh();
      }
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
      setTimeout(() => setMessage(null), 5000);
    }
  }

  const ageMinutes = generatedAtIso
    ? Math.max(
        0,
        Math.round((Date.now() - Date.parse(generatedAtIso)) / 60_000)
      )
    : null;

  let ageLabel: string;
  if (generatedAtIso == null) {
    ageLabel = "no weather snapshot yet — click Refresh to build one";
  } else if (ageMinutes == null) {
    ageLabel = "weather snapshot unknown";
  } else if (ageMinutes < 1) {
    ageLabel = "weather snapshot just now";
  } else if (ageMinutes < 60) {
    ageLabel = `weather snapshot ${ageMinutes} min ago`;
  } else if (ageMinutes < 60 * 24) {
    const hrs = Math.round(ageMinutes / 60);
    ageLabel = `weather snapshot ${hrs}h ago`;
  } else {
    const days = Math.round(ageMinutes / (60 * 24));
    ageLabel = `weather snapshot ${days} day${days === 1 ? "" : "s"} ago`;
  }

  const stale = ageMinutes != null && ageMinutes > 60 * 26; // >26h

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600">
      <span
        className={stale ? "font-semibold text-amber-700" : undefined}
      >
        {ageLabel}
      </span>
      <button
        onClick={refresh}
        disabled={busy}
        className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh now"}
      </button>
      {message && (
        <span
          className={
            message.kind === "ok" ? "text-green-700" : "text-red-700"
          }
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
