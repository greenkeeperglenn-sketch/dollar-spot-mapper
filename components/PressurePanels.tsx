"use client";

import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PhotoAssessment, PressureScore } from "@/lib/airtable";
import type { ForecastPressureRow } from "@/lib/forecast-pressure";
import { buildShareCard, copyOrDownloadBlob } from "@/lib/share-card";

const TEMP_COLOUR = "#d97706"; // amber-600
const RH_COLOUR = "#0284c7"; // sky-600
const PRESSURE_COLOUR = "#374151"; // stone-700
const TEMP_FORECAST = "#fbbf24"; // amber-300, lighter
const RH_FORECAST = "#7dd3fc"; // sky-300, lighter
const PRESSURE_FORECAST = "#9ca3af"; // stone-400

function fmt(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

type ChartRow = {
  label: string;
  date: string;
  is_forecast: boolean;
  prob_actual?: number;
  prob_forecast?: number;
  t5_actual?: number;
  t5_forecast?: number;
  rh5_actual?: number;
  rh5_forecast?: number;
  temp_term_actual?: number;
  rh_term_actual?: number;
  temp_term_forecast?: number;
  rh_term_forecast?: number;
  // Photo markers (one row per photo-date; null elsewhere). Each chart has
  // its own y so the marker sits at a sensible spot above the data.
  photo_marker_pressure?: number;
  photo_marker_logit?: number;
  photo_marker_t5?: number;
  photo_count?: number;
};

function buildRows(
  scores: PressureScore[],
  forecast: ForecastPressureRow[]
): ChartRow[] {
  const rows: ChartRow[] = [];
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    const isLast = i === scores.length - 1;
    const bridge = isLast && forecast.length > 0;
    rows.push({
      label: fmt(s.date),
      date: s.date,
      is_forecast: false,
      prob_actual: s.smith_kerns_probability,
      t5_actual: s.temp_5day_avg_c,
      rh5_actual: s.rh_5day_avg_pct,
      temp_term_actual: s.temp_term,
      rh_term_actual: s.rh_term,
      // Bridge so the dashed forecast line visually starts at today.
      ...(bridge
        ? {
            prob_forecast: s.smith_kerns_probability,
            t5_forecast: s.temp_5day_avg_c,
            rh5_forecast: s.rh_5day_avg_pct,
          }
        : {}),
    });
  }
  for (const f of forecast) {
    rows.push({
      label: fmt(f.date),
      date: f.date,
      is_forecast: true,
      prob_forecast: f.smith_kerns_probability,
      t5_forecast: f.temp_5day_avg_c,
      rh5_forecast: f.rh_5day_avg_pct,
      temp_term_forecast: f.temp_term,
      rh_term_forecast: f.rh_term,
    });
  }
  return rows;
}

export function PressurePanels({
  scores,
  forecast = [],
  photosByDate,
  onSelectPhotoDate,
  locationName,
  locationLogoUrl,
  photos,
  syncedAtIso,
  caughtUpDays = 0,
  catchUpError = null,
}: {
  scores: PressureScore[];
  forecast?: ForecastPressureRow[];
  /** date (YYYY-MM-DD) -> count of photos saved on that date */
  photosByDate?: Map<string, number>;
  onSelectPhotoDate?: (date: string) => void;
  locationName?: string;
  locationLogoUrl?: string | null;
  photos?: PhotoAssessment[];
  /** Server timestamp the data was fetched at. */
  syncedAtIso?: string | null;
  /** How many days of pressure rows the server filled in just before responding. */
  caughtUpDays?: number;
  catchUpError?: string | null;
}) {
  const today = scores[scores.length - 1];
  const data = buildRows(scores, forecast);
  const todayLabel = today ? fmt(today.date) : null;
  const forecastStartLabel =
    forecast.length > 0 ? fmt(forecast[0].date) : null;
  const forecastEndLabel =
    forecast.length > 0 ? fmt(forecast[forecast.length - 1].date) : null;
  const peak = pickPeak(forecast);

  // Compute chart-specific marker y-values so the camera dot sits above
  // the highest data point on each chart.
  const maxLogit = data.reduce((m, d) => {
    const a = (d.temp_term_actual ?? 0) + (d.rh_term_actual ?? 0);
    const f = (d.temp_term_forecast ?? 0) + (d.rh_term_forecast ?? 0);
    return Math.max(m, a, f);
  }, 0);
  const maxT5 = data.reduce(
    (m, d) => Math.max(m, d.t5_actual ?? -Infinity, d.t5_forecast ?? -Infinity),
    -Infinity
  );
  const markerPressureY = 0.95;
  const markerLogitY = maxLogit > 0 ? maxLogit * 1.05 : 1;
  const markerT5Y = Number.isFinite(maxT5) ? (maxT5 as number) + 2 : 30;

  if (photosByDate && photosByDate.size > 0) {
    for (const row of data) {
      const count = photosByDate.get(row.date);
      if (!count) continue;
      row.photo_count = count;
      row.photo_marker_pressure = markerPressureY;
      row.photo_marker_logit = markerLogitY;
      row.photo_marker_t5 = markerT5Y;
    }
  }

  const handleScatterClick = (datum: { payload?: ChartRow }) => {
    const date = datum.payload?.date;
    if (date) onSelectPhotoDate?.(date);
  };

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
      const photoDates = (photos ?? []).map((p) => p.photo_date);
      // Mean disease % across the photos that fall within the on-screen
      // window (last 30 days of scores).
      const sinceDate = scores[0]?.date ?? "0000-01-01";
      const inWindow = (photos ?? []).filter((p) => p.photo_date >= sinceDate);
      const meanDiseasePct =
        inWindow.length === 0
          ? null
          : inWindow.reduce((s, p) => s + p.disease_pct, 0) / inWindow.length;
      const blob = await buildShareCard({
        locationName: locationName ?? "Location",
        locationLogoUrl: locationLogoUrl ?? null,
        scores,
        forecast,
        photoCount: inWindow.length,
        meanDiseasePct,
        photoDates,
      });
      const how = await copyOrDownloadBlob(
        blob,
        `${(locationName ?? "location").replace(/\s+/g, "-").toLowerCase()}-pressure-${new Date()
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

  return (
    <div className="space-y-6">
      <Panel
        title="What's driving pressure"
        subtitle="Daily contribution from temperature and humidity, side by side. Forecast bars are lighter with a dashed edge."
      >
        <div className="mb-3 rounded border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700 leading-relaxed">
          <p className="font-medium text-stone-900">In plain English</p>
          <p className="mt-1">
            Disease pressure is the sum of two ingredients: <strong style={{ color: TEMP_COLOUR }}>warm temperatures</strong>{" "}
            and <strong style={{ color: RH_COLOUR }}>humid air</strong>. Each
            day's bar splits that contribution: the orange part is how much
            the 5-day average temperature is pushing pressure up, the blue
            part is how much the 5-day average humidity is pushing it up.
          </p>
          <p className="mt-2">
            <strong>Taller orange than blue?</strong> Heat is the main
            driver — pressure will fall fast on a cool spell.{" "}
            <strong>Taller blue than orange?</strong> It&rsquo;s a humid
            stretch — keep an eye out for dew, irrigation, or wet weather.{" "}
            <strong>Both growing together?</strong> Classic dollar-spot
            conditions; expect the probability above to climb.
          </p>
          <p className="mt-2 text-stone-500">
            (For the curious: each bar is the input to a logistic curve —
            the model maths is{" "}
            <code>−11.40 + 0.193·T + 0.089·RH</code>. The probability chart
            above is just that number squashed into the 0–100% range.)
          </p>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(v, k) => [Number(v).toFixed(2), String(k)]}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <Legend />
            {todayLabel && (
              <ReferenceLine
                x={todayLabel}
                stroke="#1c1917"
                strokeDasharray="4 4"
              />
            )}
            <Bar
              stackId="actual"
              dataKey="temp_term_actual"
              name="Temp (actual)"
              fill={TEMP_COLOUR}
            />
            <Bar
              stackId="actual"
              dataKey="rh_term_actual"
              name="RH (actual)"
              fill={RH_COLOUR}
            />
            <Bar
              stackId="forecast"
              dataKey="temp_term_forecast"
              name="Temp (forecast)"
              fill={TEMP_FORECAST}
              stroke={TEMP_COLOUR}
              strokeDasharray="3 2"
              strokeWidth={1}
            />
            <Bar
              stackId="forecast"
              dataKey="rh_term_forecast"
              name="RH (forecast)"
              fill={RH_FORECAST}
              stroke={RH_COLOUR}
              strokeDasharray="3 2"
              strokeWidth={1}
            />
            <Scatter
              dataKey="photo_marker_logit"
              name="Photo assessed"
              shape={CameraDot}
              onClick={handleScatterClick}
              style={{ cursor: "pointer" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      <Panel
        title="5-day means: temperature and humidity"
        subtitle="Raw inputs to the model. Solid = past actuals; dashed = forecast."
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis
              yAxisId="t"
              orientation="left"
              tick={{ fontSize: 12, fill: TEMP_COLOUR }}
              label={{
                value: "°C",
                angle: -90,
                position: "insideLeft",
                fill: TEMP_COLOUR,
                fontSize: 11,
              }}
            />
            <YAxis
              yAxisId="rh"
              orientation="right"
              domain={[0, 100]}
              tick={{ fontSize: 12, fill: RH_COLOUR }}
              label={{
                value: "%",
                angle: 90,
                position: "insideRight",
                fill: RH_COLOUR,
                fontSize: 11,
              }}
            />
            <Tooltip
              formatter={(v, k) => [Number(v).toFixed(1), String(k)]}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <Legend />
            {todayLabel && (
              <ReferenceLine
                x={todayLabel}
                yAxisId="t"
                stroke="#1c1917"
                strokeDasharray="4 4"
              />
            )}
            <Line
              yAxisId="t"
              type="monotone"
              dataKey="t5_actual"
              name="T5 (°C, actual)"
              stroke={TEMP_COLOUR}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="t"
              type="monotone"
              dataKey="t5_forecast"
              name="T5 (°C, forecast)"
              stroke={TEMP_COLOUR}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="rh"
              type="monotone"
              dataKey="rh5_actual"
              name="RH5 (%, actual)"
              stroke={RH_COLOUR}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="rh"
              type="monotone"
              dataKey="rh5_forecast"
              name="RH5 (%, forecast)"
              stroke={RH_COLOUR}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={false}
            />
            <Scatter
              yAxisId="t"
              dataKey="photo_marker_t5"
              name="Photo assessed"
              shape={CameraDot}
              onClick={handleScatterClick}
              style={{ cursor: "pointer" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}

// Custom Scatter shape: a small numbered camera-dot above the chart at
// the photo date. Outline + fill so it pops against any background.
type DotProps = {
  cx?: number;
  cy?: number;
  payload?: ChartRow;
};
function CameraDot(props: DotProps) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const count = payload?.photo_count ?? 0;
  if (!count) return null;
  return (
    <g pointerEvents="all">
      <circle
        cx={cx}
        cy={cy}
        r={9}
        fill="#0284c7"
        stroke="#ffffff"
        strokeWidth={2}
      />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        fontSize={11}
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
): { date: string; probability: number; risk_band: string } | null {
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

function Panel({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-stone-900">
            {title}
          </h2>
          <p className="text-xs text-stone-500">{subtitle}</p>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

function TodayCard({
  score,
  peak,
  syncedAtIso,
  caughtUpDays,
  catchUpError,
}: {
  score: PressureScore | undefined;
  peak: { date: string; probability: number; risk_band: string } | null;
  syncedAtIso: string | null;
  caughtUpDays: number;
  catchUpError: string | null;
}) {
  if (!score) return null;
  const colour =
    score.risk_band === "High"
      ? "bg-red-50 border-red-200 text-red-900"
      : score.risk_band === "Moderate"
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : "bg-green-50 border-green-200 text-green-900";

  const yesterdayIso = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const stale = score.date < yesterdayIso;
  const lagDays = Math.max(
    0,
    Math.round(
      (new Date(`${yesterdayIso}T00:00:00Z`).getTime() -
        new Date(`${score.date}T00:00:00Z`).getTime()) /
        86_400_000
    )
  );

  return (
    <section className={`rounded-lg border p-4 ${colour}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70">
            Latest pressure ({fmt(score.date)})
          </div>
          <div className="mt-1 text-4xl font-semibold tabular-nums">
            {(score.smith_kerns_probability * 100).toFixed(0)}%
          </div>
          <div className="mt-1 text-sm">Risk band: {score.risk_band}</div>
        </div>
        {peak && (
          <div className="rounded border border-stone-300 bg-white/60 px-3 py-2 text-stone-900">
            <div className="text-xs uppercase tracking-wide text-stone-500">
              Peak in next 14 days (forecast)
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {(peak.probability * 100).toFixed(0)}%{" "}
              <span className="text-xs font-normal text-stone-500">
                on {fmt(peak.date)}
              </span>
            </div>
            <div className="text-xs">Risk band: {peak.risk_band}</div>
          </div>
        )}
        <div className="text-xs leading-relaxed font-mono">
          logit = −11.40 + {score.temp_term.toFixed(2)} (T5={" "}
          {score.temp_5day_avg_c.toFixed(1)}°C) +{" "}
          {score.rh_term.toFixed(2)} (RH5={" "}
          {score.rh_5day_avg_pct.toFixed(0)}%)
          <br />→ p = {score.smith_kerns_probability.toFixed(3)}
        </div>
      </div>

      <div className="mt-3 border-t border-current/15 pt-2 text-[11px] opacity-80">
        {syncedAtIso && (
          <span>Synced {formatRelativeTime(syncedAtIso)}.</span>
        )}{" "}
        {caughtUpDays > 0 && (
          <span>
            Pulled {caughtUpDays} new day{caughtUpDays === 1 ? "" : "s"} of
            weather just now.
          </span>
        )}
        {stale && lagDays > 0 && (
          <span className="ml-1">
            Latest stored row is {lagDays} day{lagDays === 1 ? "" : "s"} old —{" "}
            {catchUpError
              ? `couldn't fetch newer data (${catchUpError}).`
              : "Open-Meteo doesn't have anything fresher yet."}
          </span>
        )}
      </div>
    </section>
  );
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
    hour: "2-digit",
    minute: "2-digit",
  });
}
