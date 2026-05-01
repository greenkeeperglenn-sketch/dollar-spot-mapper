"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PressureScore } from "@/lib/airtable";

const TEMP_COLOUR = "#d97706"; // amber-600
const RH_COLOUR = "#0284c7"; // sky-600
const PRESSURE_COLOUR = "#374151"; // stone-700

function fmt(d: string): string {
  // YYYY-MM-DD -> "1 May"
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function PressurePanels({ scores }: { scores: PressureScore[] }) {
  const today = scores[scores.length - 1];
  const data = scores.map((s) => ({
    ...s,
    label: fmt(s.date),
  }));

  return (
    <div className="space-y-6">
      <TodayCard score={today} />

      <Panel
        title="Smith-Kerns probability"
        subtitle="30-day history. Background bands: green = Low (<0.20), amber = Moderate (0.20–0.30), red = High (≥0.30)."
      >
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v) => v.toFixed(2)}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              formatter={(v) => Number(v).toFixed(3)}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <ReferenceArea y1={0} y2={0.2} fill="#dcfce7" fillOpacity={0.4} />
            <ReferenceArea y1={0.2} y2={0.3} fill="#fef3c7" fillOpacity={0.5} />
            <ReferenceArea y1={0.3} y2={1} fill="#fee2e2" fillOpacity={0.5} />
            <Line
              type="monotone"
              dataKey="smith_kerns_probability"
              name="P(infection)"
              stroke={PRESSURE_COLOUR}
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      <Panel
        title="What's driving pressure"
        subtitle="Stacked contribution to the logit, above the −11.40 intercept. Taller bar = bigger driver of disease pressure that day."
      >
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(v, k) => [Number(v).toFixed(2), String(k)]}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <Legend />
            <Bar
              stackId="logit"
              dataKey="temp_term"
              name="Temperature (0.193 · T5)"
              fill={TEMP_COLOUR}
            />
            <Bar
              stackId="logit"
              dataKey="rh_term"
              name="Humidity (0.089 · RH5)"
              fill={RH_COLOUR}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      <Panel
        title="5-day means: temperature and humidity"
        subtitle="Raw inputs to the model. Temperature on the left axis (°C), relative humidity on the right (%)."
      >
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
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
            <Area
              yAxisId="t"
              type="monotone"
              dataKey="temp_5day_avg_c"
              name="T5 (°C)"
              stroke={TEMP_COLOUR}
              fill={TEMP_COLOUR}
              fillOpacity={0.2}
              dot={false}
            />
            <Line
              yAxisId="rh"
              type="monotone"
              dataKey="rh_5day_avg_pct"
              name="RH5 (%)"
              stroke={RH_COLOUR}
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
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

function TodayCard({ score }: { score: PressureScore }) {
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
