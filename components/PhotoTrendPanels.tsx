"use client";

import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PhotoAssessment } from "@/lib/airtable";
import {
  groupPhotosByDate,
  type PhotoDayGroup,
} from "@/lib/photo-aggregations";

const MEAN_COLOUR = "#374151";
const POINT_COLOUR = "#0284c7";

type ChartPoint = {
  label: string;
  date?: string;
  mean?: number;
  point?: number;
  quadrat?: string;
};

export function PhotoTrendPanels({
  photos,
  onSelectDate,
}: {
  photos: PhotoAssessment[];
  onSelectDate?: (date: string) => void;
}) {
  const groups = groupPhotosByDate(photos);

  if (groups.length === 0) {
    return (
      <Card title="Photo assessments">
        <p className="text-sm text-stone-500">
          No photos for this location yet. Upload one from{" "}
          <a href="/assess" className="underline">
            Assess photo
          </a>
          .
        </p>
      </Card>
    );
  }

  const subtitleSuffix = onSelectDate
    ? " Click a dot to view that day's photo with the foci overlay."
    : "";

  return (
    <div className="space-y-6">
      <TrendCard
        title="Foci count over time"
        subtitle={`Line = mean across all quadrats on that date. Dots = individual quadrats.${subtitleSuffix}`}
        groups={groups}
        valueFor={(p) => p.foci_count}
        meanFor={(g) => Number(g.meanFoci.toFixed(2))}
        formatValue={(v) => Number(v).toFixed(0)}
        onSelectDate={onSelectDate}
      />
      <TrendCard
        title="Disease coverage over time"
        subtitle={`Percentage of the 1m² showing disease. Line = location mean across quadrats.${subtitleSuffix}`}
        groups={groups}
        valueFor={(p) => p.disease_pct}
        meanFor={(g) => Number(g.meanPct.toFixed(2))}
        yDomain={[0, "auto"]}
        formatValue={(v) => `${Number(v).toFixed(1)}%`}
        onSelectDate={onSelectDate}
      />
    </div>
  );
}

function TrendCard({
  title,
  subtitle,
  groups,
  valueFor,
  meanFor,
  yDomain,
  formatValue,
  onSelectDate,
}: {
  title: string;
  subtitle: string;
  groups: PhotoDayGroup[];
  valueFor: (p: PhotoAssessment) => number;
  meanFor: (g: PhotoDayGroup) => number;
  yDomain?: [number | "auto", number | "auto"];
  formatValue: (v: number | string) => string;
  onSelectDate?: (date: string) => void;
}) {
  // Recharts wants one flat array. We emit one row per group for the line
  // and additional rows for each individual scatter point.
  const data: ChartPoint[] = [];
  for (const g of groups) {
    data.push({ label: shortDate(g.date), date: g.date, mean: meanFor(g) });
    for (const p of g.list) {
      data.push({
        label: shortDate(g.date),
        date: g.date,
        point: valueFor(p),
        quadrat: p.quadrat_label,
      });
    }
  }
  const handleClick = (datum: { payload?: ChartPoint }) => {
    const d = datum.payload?.date;
    if (d) onSelectDate?.(d);
  };
  return (
    <Card title={title} subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} domain={yDomain} />
          <Tooltip formatter={(v) => formatValue(v as number)} />
          <Legend />
          <Line
            type="monotone"
            dataKey="mean"
            name="Location mean"
            stroke={MEAN_COLOUR}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Scatter
            dataKey="point"
            name="Per quadrat"
            fill={POINT_COLOUR}
            onClick={onSelectDate ? handleClick : undefined}
            style={onSelectDate ? { cursor: "pointer" } : undefined}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight text-stone-900">
          {title}
        </h2>
        {subtitle && <p className="text-xs text-stone-500">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
