"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PressureScore } from "@/lib/airtable";
import type { ForecastPressureRow } from "@/lib/forecast-pressure";

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
}: {
  scores: PressureScore[];
  forecast?: ForecastPressureRow[];
}) {
  const today = scores[scores.length - 1];
  const data = buildRows(scores, forecast);
  const todayLabel = today ? fmt(today.date) : null;
  const forecastStartLabel =
    forecast.length > 0 ? fmt(forecast[0].date) : null;
  const forecastEndLabel =
    forecast.length > 0 ? fmt(forecast[forecast.length - 1].date) : null;
  const peak = pickPeak(forecast);

  return (
    <div className="space-y-6">
      <TodayCard score={today} peak={peak} />

      <Panel
        title="Smith-Kerns probability"
        subtitle={`30-day history. Forecast (dashed) — next ${forecast.length} days from Open-Meteo. Risk bands: green Low (<0.20), amber Moderate (0.20–0.30), red High (≥0.30).`}
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v) => v.toFixed(2)}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              formatter={(v, k) => [
                Number(v).toFixed(3),
                String(k).includes("forecast") ? "P (forecast)" : "P (actual)",
              ]}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <ReferenceArea y1={0} y2={0.2} fill="#dcfce7" fillOpacity={0.4} />
            <ReferenceArea y1={0.2} y2={0.3} fill="#fef3c7" fillOpacity={0.5} />
            <ReferenceArea y1={0.3} y2={1} fill="#fee2e2" fillOpacity={0.5} />
            {forecastStartLabel && forecastEndLabel && (
              <ReferenceArea
                x1={forecastStartLabel}
                x2={forecastEndLabel}
                fill="#000000"
                fillOpacity={0.04}
                ifOverflow="extendDomain"
              />
            )}
            {todayLabel && (
              <ReferenceLine
                x={todayLabel}
                stroke="#1c1917"
                strokeDasharray="4 4"
                label={{
                  value: "Today",
                  position: "insideTop",
                  fontSize: 11,
                  fill: "#1c1917",
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="prob_actual"
              name="Actual"
              stroke={PRESSURE_COLOUR}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="prob_forecast"
              name="Forecast"
              stroke={PRESSURE_FORECAST}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      <Panel
        title="What's driving pressure"
        subtitle="Stacked contribution to the logit, above the −11.40 intercept. Forecast bars are lighter / dashed-edge."
      >
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
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
    </div>
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
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight text-stone-900">
          {title}
        </h2>
        <p className="text-xs text-stone-500">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function TodayCard({
  score,
  peak,
}: {
  score: PressureScore | undefined;
  peak: { date: string; probability: number; risk_band: string } | null;
}) {
  if (!score) return null;
  const colour =
    score.risk_band === "High"
      ? "bg-red-50 border-red-200 text-red-900"
      : score.risk_band === "Moderate"
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : "bg-green-50 border-green-200 text-green-900";
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
    </section>
  );
}
