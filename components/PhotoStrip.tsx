"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { PhotoAssessment, PressureScore } from "@/lib/airtable";
import type { Focus } from "@/lib/focus";
import { bandFor } from "@/lib/smith-kerns";
import { bandPalette, neutralPalette } from "@/lib/risk-palette";
import { RectifiedCanvasView } from "./RectifiedCanvasView";

/**
 * Per-site timeline gallery. Renders the chronological photo gallery for
 * the currently selected site, with the average Smith-Kerns pressure
 * between consecutive visits in the gaps. Site chips at the top switch
 * between sites for the active location.
 */
export function PhotoStrip({
  photos,
  scores,
  siteOrder = [],
  onSelect,
  selectedDate,
}: {
  photos: PhotoAssessment[];
  scores: PressureScore[];
  siteOrder?: string[];
  onSelect: (date: string) => void;
  selectedDate?: string | null;
}) {
  const bySite = useMemo(() => {
    const m = new Map<string, PhotoAssessment[]>();
    for (const p of photos) {
      const k = p.quadrat_label || "(unlabelled)";
      const list = m.get(k) ?? [];
      list.push(p);
      m.set(k, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.photo_date.localeCompare(b.photo_date));
    }
    return m;
  }, [photos]);

  const siteRows = useMemo(
    () =>
      Array.from(bySite.entries()).sort((a, b) =>
        compareSites(a[0], b[0], siteOrder)
      ),
    [bySite, siteOrder]
  );

  const firstSite = siteRows[0]?.[0] ?? null;
  const [focusedSite, setFocusedSite] = useState<string | null>(firstSite);

  // Snap the active site to a valid one whenever the available sites
  // change (location switch, first load, etc.).
  useEffect(() => {
    if (siteRows.length === 0) {
      if (focusedSite !== null) setFocusedSite(null);
      return;
    }
    if (!focusedSite || !bySite.has(focusedSite)) {
      setFocusedSite(siteRows[0][0]);
    }
  }, [siteRows, bySite, focusedSite]);

  if (photos.length === 0) {
    return (
      <section className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-500">
        No photos for this location yet.{" "}
        <a href="/assess" className="underline">
          Assess one
        </a>
        .
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-stone-900">
            {focusedSite ?? "Saved photos"}
          </h2>
          <p className="text-xs text-stone-500">
            Chronological gallery — pressure between visits is shown in the
            gaps.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {siteRows.map(([site, list]) => (
            <SiteChip
              key={site}
              label={site}
              count={list.length}
              active={focusedSite === site}
              onClick={() => setFocusedSite(site)}
            />
          ))}
        </div>
      </header>

      {focusedSite && (
        <SiteGallery
          photos={bySite.get(focusedSite) ?? []}
          scores={scores}
          onSelect={onSelect}
          selectedDate={selectedDate ?? null}
        />
      )}
    </section>
  );
}

function SiteChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active
          ? "border-stone-900 bg-stone-900 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
      }`}
    >
      {label}{" "}
      <span
        className={`tabular-nums ${
          active ? "text-stone-300" : "text-stone-500"
        }`}
      >
        ({count})
      </span>
    </button>
  );
}

function SiteGallery({
  photos,
  scores,
  onSelect,
  selectedDate,
}: {
  photos: PhotoAssessment[];
  scores: PressureScore[];
  onSelect: (date: string) => void;
  selectedDate: string | null;
}) {
  // photos are sorted asc by date already.
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-stretch gap-3">
        {photos.map((p, i) => (
          <Fragment key={p.id}>
            <GalleryCard
              photo={p}
              onSelect={() => onSelect(p.photo_date)}
              selected={selectedDate === p.photo_date}
            />
            {i < photos.length - 1 && (
              <PressureDelta
                fromDate={p.photo_date}
                toDate={photos[i + 1].photo_date}
                scores={scores}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

type AuditJson = {
  parsed?: { foci?: Focus[] };
  user_override?: { foci?: Focus[] } | null;
};

function GalleryCard({
  photo,
  onSelect,
  selected,
}: {
  photo: PhotoAssessment;
  onSelect: () => void;
  selected: boolean;
}) {
  const [foci, setFoci] = useState<Focus[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch(photo.audit_json_url, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AuditJson>) : null))
      .then((j) => {
        if (cancelled || !j) return;
        setFoci(j.user_override?.foci ?? j.parsed?.foci ?? undefined);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [photo.audit_json_url]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group flex shrink-0 cursor-pointer flex-col items-stretch gap-1 rounded-lg border-2 bg-white p-1.5 transition-colors ${
        selected
          ? "border-blue-500 ring-2 ring-blue-200"
          : "border-stone-200 hover:border-stone-400"
      }`}
      style={{ width: 232 }}
      title={`${photo.quadrat_label} · ${photo.photo_date}`}
    >
      <div
        className="relative overflow-hidden rounded bg-stone-100"
        style={{ width: 220, height: 220 }}
      >
        <RectifiedCanvasView
          imageUrl={photo.rectified_image_url}
          foci={foci}
          fociCount={photo.foci_count}
          diseasePct={photo.disease_pct}
          maxWidth={220}
          initialMode="disease"
        />
      </div>
      <div className="flex items-center justify-between px-1 pt-1 text-[11px] font-medium text-stone-700">
        <span className="tabular-nums">{fmt(photo.photo_date)}</span>
        <span className="tabular-nums">
          {photo.disease_pct.toFixed(1)}% · {photo.foci_count} foci
        </span>
      </div>
    </div>
  );
}

function PressureDelta({
  fromDate,
  toDate,
  scores,
}: {
  fromDate: string;
  toDate: string;
  scores: PressureScore[];
}) {
  // Days strictly after fromDate up to and including toDate — the days
  // during which any disease change developed.
  const inRange = scores.filter(
    (s) => s.date > fromDate && s.date <= toDate
  );
  const avg =
    inRange.length > 0
      ? inRange.reduce((acc, s) => acc + s.smith_kerns_probability, 0) /
        inRange.length
      : null;
  const days = daysBetween(fromDate, toDate);
  const palette = avg != null ? bandPalette(bandFor(avg)) : neutralPalette();
  return (
    <div
      className="flex shrink-0 flex-col items-center justify-center self-stretch rounded-md border px-3 py-2 text-center"
      style={{
        background: palette.bg,
        borderColor: palette.border,
        color: palette.fg,
        minWidth: 92,
      }}
      title={
        avg != null
          ? `Average Smith-Kerns probability across the ${inRange.length} day${
              inRange.length === 1 ? "" : "s"
            } between ${fromDate} and ${toDate}`
          : "No pressure data in this gap"
      }
    >
      <div className="text-[9px] font-semibold uppercase tracking-wide opacity-80">
        Avg pressure
      </div>
      <div className="text-2xl font-bold tabular-nums">
        {avg != null ? `${Math.round(avg * 100)}%` : "—"}
      </div>
      <div className="text-[10px] tabular-nums opacity-80">
        {days} day{days === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function fmt(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Order sites by the location's `sites` field (one per line in Airtable).
 * Sites not listed there fall to the bottom in alphabetical order. This
 * keeps the strip layout stable across page loads and across days when
 * new photos arrive.
 */
export function compareSites(
  a: string,
  b: string,
  order: string[]
): number {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}
