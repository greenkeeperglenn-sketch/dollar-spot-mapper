"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PhotoAssessment, PressureScore } from "@/lib/airtable";
import type { ForecastPressureRow } from "@/lib/forecast-pressure";
import { buildShareCard, copyOrDownloadBlob } from "@/lib/share-card";

const PRESSURE = "#374151";
const FORECAST = "#9ca3af";
const PHOTO = "#0284c7";

const PX_PER_DAY = 28; // density of horizontal axis when chart needs to scroll

export type Range = "30d" | "90d" | "season";

const RANGE_LABELS: Record<Range, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  season: "Season to date",
};

type ChartRow = {
  label: string;
  date: string;
  prob_actual?: number;
  prob_forecast?: number;
  photo_marker?: number;
  photo_count?: number;
};

export function HeroSummary({
  locationName,
  locationLogoUrl,
  scores,
  forecast,
  photos,
  range,
  onRangeChange,
  onSelectPhotoDate,
  syncedAtIso,
  caughtUpDays,
  catchUpError,
}: {
  locationName: string;
  locationLogoUrl?: string | null;
  scores: PressureScore[];
  forecast: ForecastPressureRow[];
  photos: PhotoAssessment[];
  range: Range;
  onRangeChange: (r: Range) => void;
  onSelectPhotoDate?: (date: string) => void;
  syncedAtIso?: string | null;
  caughtUpDays: number;
  catchUpError: string | null;
}) {
  const today = scores[scores.length - 1];
  const peak = pickPeak(forecast);

  // Photo count per date for marker dots, plus mean disease % (filtered to
  // the visible window) for the share card.
  const photoCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of photos) {
      m.set(p.photo_date, (m.get(p.photo_date) ?? 0) + 1);
    }
    return m;
  }, [photos]);

  const sinceDate = scores[0]?.date ?? "0000-01-01";
  const inWindow = useMemo(
    () => photos.filter((p) => p.photo_date >= sinceDate),
    [photos, sinceDate]
  );
  const meanDiseasePct =
    inWindow.length === 0
      ? null
      : inWindow.reduce((s, p) => s + p.disease_pct, 0) / inWindow.length;

  // Build the chart rows.
  const data: ChartRow[] = useMemo(() => {
    const rows: ChartRow[] = [];
    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      const isLast = i === scores.length - 1;
      rows.push({
        label: fmt(s.date),
        date: s.date,
        prob_actual: s.smith_kerns_probability,
        ...(isLast && forecast.length > 0
          ? { prob_forecast: s.smith_kerns_probability }
          : {}),
      });
    }
    for (const f of forecast) {
      rows.push({
        label: fmt(f.date),
        date: f.date,
        prob_forecast: f.smith_kerns_probability,
      });
    }
    // Add photo markers
    const observedMax = rows.reduce((m, r) => {
      return Math.max(m, r.prob_actual ?? 0, r.prob_forecast ?? 0);
    }, 0);
    const yMax = Math.max(0.6, observedMax * 1.1);
    // Lowered slightly from the top so the upward-pointing pin (~44px tall)
    // fits within the chart area without being clipped.
    const markerY = yMax * 0.83;
    for (const r of rows) {
      const c = photoCountByDate.get(r.date);
      if (c) {
        r.photo_marker = markerY;
        r.photo_count = c;
      }
    }
    return rows;
  }, [scores, forecast, photoCountByDate]);

  const observedMax = data.reduce(
    (m, r) => Math.max(m, r.prob_actual ?? 0, r.prob_forecast ?? 0),
    0
  );
  const yMax = Math.max(0.6, observedMax * 1.1);
  const todayLabel = today ? fmt(today.date) : null;
  const minChartWidth = Math.max(400, data.length * PX_PER_DAY);

  // Scroll the chart all the way to the right whenever the data set changes,
  // so the user always sees Today + the forecast first. They can swipe back
  // to look at older history.
  const chartScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chartScrollRef.current;
    if (!el) return;
    // Wait a frame so the inner chart has rendered at its full width.
    const id = requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
    return () => cancelAnimationFrame(id);
  }, [data.length, minChartWidth]);

  // Copy-share state
  const [shareStatus, setShareStatus] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "ok"; how: "clipboard" | "download" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleCopyShare() {
    if (shareStatus.kind === "busy") return;
    setShareStatus({ kind: "busy" });
    try {
      const blob = await buildShareCard({
        locationName,
        locationLogoUrl: locationLogoUrl ?? null,
        scores,
        forecast,
        photoCount: inWindow.length,
        meanDiseasePct,
        photoDates: photos.map((p) => p.photo_date),
      });
      const how = await copyOrDownloadBlob(
        blob,
        `${locationName.replace(/\s+/g, "-").toLowerCase()}-pressure-${new Date()
          .toISOString()
          .slice(0, 10)}.png`
      );
      setShareStatus({ kind: "ok", how });
      setTimeout(() => setShareStatus({ kind: "idle" }), 4000);
    } catch (e) {
      setShareStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      setTimeout(() => setShareStatus({ kind: "idle" }), 6000);
    }
  }

  const handleScatterClick = (datum: { payload?: ChartRow }) => {
    const date = datum.payload?.date;
    if (date) onSelectPhotoDate?.(date);
  };

  return (
    <section className="space-y-4 rounded-xl border-2 border-stone-200 bg-white p-4 sm:p-6 shadow-sm">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-4">
        {locationLogoUrl && (
          <Image
            src={locationLogoUrl}
            alt={`${locationName} logo`}
            width={120}
            height={64}
            unoptimized
            className="h-20 w-auto rounded border border-stone-200 bg-white object-contain p-1.5 sm:h-24"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
            {locationName}
          </h1>
          <p className="text-sm text-stone-600 sm:text-base">
            Dollar spot pressure
          </p>
        </div>
        <Image
          src="/stri-logo.png"
          alt="STRI"
          width={108}
          height={40}
          priority
          className="h-12 w-auto sm:h-16"
        />
      </header>

      {/* Three big stat tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="Today"
          big={today ? `${pct(today.smith_kerns_probability)}` : "—"}
          sub={
            today
              ? `${fmt(today.date)} · ${today.risk_band}`
              : "no pressure data yet"
          }
          band={today?.risk_band ?? "Low"}
          showColour={!!today}
        />
        <Tile
          label="Peak in next 14 days"
          big={peak ? pct(peak.probability) : "—"}
          sub={
            peak ? `${fmt(peak.date)} · ${peak.risk_band}` : "no forecast"
          }
          band={peak?.risk_band ?? "Low"}
          showColour={!!peak}
        />
        <Tile
          label="Photos assessed"
          big={String(inWindow.length)}
          sub={
            meanDiseasePct != null
              ? `${meanDiseasePct.toFixed(1)}% mean disease coverage`
              : "no photos in this window"
          }
          band="Low"
          showColour={false}
        />
      </div>

      {/* Range + share buttons */}
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
        <span className="text-xs uppercase tracking-wide text-stone-500">
          Range
        </span>
        <div className="inline-flex overflow-hidden rounded-md border border-stone-300 text-xs">
          {(["30d", "90d", "season"] as const).map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              className={`px-2.5 py-1 transition-colors ${
                range === r
                  ? "bg-stone-900 text-white"
                  : "bg-white text-stone-700 hover:bg-stone-50"
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-col items-end gap-1">
          <button
            onClick={handleCopyShare}
            disabled={shareStatus.kind === "busy"}
            className="rounded border border-stone-300 bg-white px-3 py-1 text-xs font-medium hover:bg-stone-50 disabled:opacity-50"
          >
            {shareStatus.kind === "busy"
              ? "Building…"
              : "📋 Copy share image"}
          </button>
          {shareStatus.kind === "ok" && (
            <span className="text-[11px] text-green-700">
              {shareStatus.how === "clipboard"
                ? "Copied — paste into WhatsApp."
                : "Downloaded."}
            </span>
          )}
          {shareStatus.kind === "error" && (
            <span className="text-[11px] text-red-700">
              {shareStatus.message}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable chart — defaults scrolled to the right so the forecast
           is on screen immediately. */}
      <div ref={chartScrollRef} className="overflow-x-auto">
        <div style={{ minWidth: `${minChartWidth}px`, height: 300 }}>
          <ComposedChart
            data={data}
            width={minChartWidth}
            height={300}
            margin={{ top: 20, right: 20, left: 0, bottom: 30 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, yMax]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 12 }}
              width={48}
            />
            <Tooltip
              formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
              labelFormatter={(l) => `Date: ${l}`}
            />
            {/* Risk-band shading. y2 caps at yMax (which is 0.6 by default,
                grows above 60% if data exceeds) — using y2={1} like before
                left the red band clipped by Recharts because it sat outside
                the chart's y-domain. */}
            <ReferenceArea y1={0} y2={0.2} fill="#22c55e" fillOpacity={0.12} />
            <ReferenceArea
              y1={0.2}
              y2={0.3}
              fill="#f59e0b"
              fillOpacity={0.18}
            />
            <ReferenceArea
              y1={0.3}
              y2={yMax}
              fill="#ef4444"
              fillOpacity={0.22}
            />
            {todayLabel && (
              <ReferenceLine
                x={todayLabel}
                stroke="#1c1917"
                strokeDasharray="4 4"
                label={renderTodayPill(todayLabel)}
              />
            )}
            <Line
              type="monotone"
              dataKey="prob_actual"
              name="Actual"
              stroke={PRESSURE}
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="prob_forecast"
              name="Forecast"
              stroke={FORECAST}
              strokeWidth={2.5}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={false}
            />
            <Scatter
              dataKey="photo_marker"
              name="Photo assessed"
              shape={CameraDot}
              onClick={handleScatterClick}
              style={{ cursor: "pointer" }}
            />
          </ComposedChart>
        </div>
      </div>

      {/* Legend + freshness */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600">
        <LegendDash colour={PRESSURE} label="Actual" />
        <LegendDash colour={FORECAST} label="Forecast" dashed />
        <LegendDot colour={PHOTO} label="Photo assessed" />
        <span className="ml-auto text-[11px] text-stone-500">
          Y-axis caps at 60% (extends if data goes higher).{" "}
          {syncedAtIso && <>Synced {formatRelativeTime(syncedAtIso)}.</>}{" "}
          {caughtUpDays > 0 && (
            <>Pulled {caughtUpDays} new day{caughtUpDays === 1 ? "" : "s"}.</>
          )}
          {catchUpError && (
            <span className="ml-1 text-amber-700">
              ({catchUpError})
            </span>
          )}
        </span>
      </div>
    </section>
  );
}

function Tile({
  label,
  big,
  sub,
  band,
  showColour,
}: {
  label: string;
  big: string;
  sub: string;
  band: "Low" | "Moderate" | "High";
  showColour: boolean;
}) {
  const palette = showColour ? bandPalette(band) : neutralPalette();
  return (
    <div
      className="flex flex-col items-center rounded-lg border-2 p-4 text-center sm:p-5"
      style={{ background: palette.bg, borderColor: palette.border }}
    >
      <div
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: palette.fg }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-4xl font-bold tabular-nums sm:text-5xl"
        style={{ color: palette.fg }}
      >
        {big}
      </div>
      <div className="mt-2 text-sm" style={{ color: palette.fg }}>
        {sub}
      </div>
    </div>
  );
}

function bandPalette(band: "Low" | "Moderate" | "High") {
  if (band === "High") {
    return { bg: "#fef2f2", border: "#fca5a5", fg: "#991b1b" };
  }
  if (band === "Moderate") {
    return { bg: "#fffbeb", border: "#fcd34d", fg: "#92400e" };
  }
  return { bg: "#f0fdf4", border: "#86efac", fg: "#166534" };
}
function neutralPalette() {
  return { bg: "#f0f9ff", border: "#7dd3fc", fg: "#075985" };
}

function LegendDash({
  colour,
  label,
  dashed,
}: {
  colour: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-0 w-6 border-t-[3px]"
        style={{
          borderColor: colour,
          borderStyle: dashed ? "dashed" : "solid",
        }}
      />
      {label}
    </span>
  );
}
function LegendDot({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-3 w-3 rounded-full"
        style={{ background: colour }}
      />
      {label}
    </span>
  );
}

type DotProps = {
  cx?: number;
  cy?: number;
  payload?: ChartRow;
};
type TodayLabelProps = { viewBox?: { x?: number; y?: number } };

function renderTodayPill(date: string) {
  return function TodayPill(props: TodayLabelProps) {
    const vb = props.viewBox;
    const lineX = vb?.x;
    const top = vb?.y;
    if (lineX == null || top == null) return null;
    const padX = 8;
    const charW = 7; // rough mono-ish width estimate at 12px
    const pillW = date.length * charW + padX * 2;
    const pillH = 22;
    const pillX = lineX - pillW / 2;
    const pillY = top + 4;
    return (
      <g>
        <rect
          x={pillX}
          y={pillY}
          width={pillW}
          height={pillH}
          rx={5}
          fill="#1c1917"
        />
        <polygon
          points={`${lineX - 5},${pillY + pillH} ${lineX + 5},${
            pillY + pillH
          } ${lineX},${pillY + pillH + 5}`}
          fill="#1c1917"
        />
        <text
          x={lineX}
          y={pillY + pillH / 2 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={12}
          fontWeight={700}
          fill="#ffffff"
        >
          {date}
        </text>
      </g>
    );
  };
}

function CameraDot(props: DotProps) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const count = payload?.photo_count ?? 0;
  if (!count) return null;
  // Map-pin shape: tip at (cx, cy), circle above. r=16 circle centered
  // at (cx, cy-28). Tangent points at (cx±11, cy-16).
  const pinPath = `M ${cx} ${cy} L ${cx - 11} ${cy - 16} A 16 16 0 1 1 ${
    cx + 11
  } ${cy - 16} Z`;
  return (
    <g pointerEvents="all">
      <path
        d={pinPath}
        fill={PHOTO}
        stroke="#ffffff"
        strokeWidth={2.5}
      />
      <text
        x={cx}
        y={cy - 28}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={16}
        fontWeight={700}
        fill="#ffffff"
      >
        {count > 9 ? "9+" : count}
      </text>
    </g>
  );
}

function pickPeak(
  forecast: ForecastPressureRow[]
): { date: string; probability: number; risk_band: "Low" | "Moderate" | "High" } | null {
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

function fmt(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
