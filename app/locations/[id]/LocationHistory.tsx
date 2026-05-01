"use client";

import { useMemo } from "react";
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
import type { PhotoAssessment, PressureScore } from "@/lib/airtable";

export function LocationHistory({
  pressure,
  photos,
}: {
  pressure: PressureScore[];
  photos: PhotoAssessment[];
}) {
  // Group photos by date to compute per-date means
  const photoGroups = useMemo(() => {
    const map = new Map<string, PhotoAssessment[]>();
    for (const p of photos) {
      const list = map.get(p.photo_date) ?? [];
      list.push(p);
      map.set(p.photo_date, list);
    }
    const groups = Array.from(map.entries())
      .map(([date, list]) => ({
        date,
        list,
        meanFoci: list.reduce((s, p) => s + p.foci_count, 0) / list.length,
        meanPct: list.reduce((s, p) => s + p.disease_pct, 0) / list.length,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return groups;
  }, [photos]);

  return (
    <div className="space-y-6">
      <PressureSection pressure={pressure} />
      <PhotosTimeline groups={photoGroups} />
      <PhotosTable groups={photoGroups} />
    </div>
  );
}

function PressureSection({ pressure }: { pressure: PressureScore[] }) {
  if (pressure.length === 0) {
    return (
      <Card title="Disease pressure">
        <p className="text-sm text-stone-500">
          No pressure data yet. Backfill or wait for the daily cron.
        </p>
      </Card>
    );
  }
  const data = pressure.map((p) => ({ ...p, label: shortDate(p.date) }));
  return (
    <Card
      title="Disease pressure (Smith-Kerns)"
      subtitle="Last 120 days. Risk band is computed from the probability."
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
          <Tooltip formatter={(v) => Number(v).toFixed(3)} />
          <Line
            type="monotone"
            dataKey="smith_kerns_probability"
            name="P(infection)"
            stroke="#374151"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

function PhotosTimeline({
  groups,
}: {
  groups: ReturnType<typeof groupShape>;
}) {
  if (groups.length === 0) {
    return (
      <Card title="Photo assessments">
        <p className="text-sm text-stone-500">
          No photos yet. Upload one from the Assess page.
        </p>
      </Card>
    );
  }
  // Recharts wants a flat array; we render two series:
  // 1. Per-quadrat scatter points
  // 2. Per-date mean line
  const scatterPoints = groups.flatMap((g) =>
    g.list.map((p) => ({
      label: shortDate(g.date),
      foci: p.foci_count,
      quadrat: p.quadrat_label,
    }))
  );
  const meanLine = groups.map((g) => ({
    label: shortDate(g.date),
    mean: Number(g.meanFoci.toFixed(2)),
  }));
  // Merge by label so the line and scatter share an x-axis
  const merged: Array<{
    label: string;
    mean?: number;
    foci?: number;
    quadrat?: string;
  }> = [];
  const seen = new Set<string>();
  for (const m of meanLine) {
    merged.push({ label: m.label, mean: m.mean });
    seen.add(m.label);
  }
  for (const s of scatterPoints) {
    merged.push(s);
  }
  // sort by date roughly via group order
  return (
    <Card
      title="Foci count over time"
      subtitle="Line = location-level mean across all quadrats on that date. Dots = individual quadrats."
    >
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={merged}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="mean"
            name="Location mean"
            stroke="#374151"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Scatter dataKey="foci" name="Per quadrat" fill="#0284c7" />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

function PhotosTable({
  groups,
}: {
  groups: ReturnType<typeof groupShape>;
}) {
  if (groups.length === 0) return null;
  return (
    <Card title="Per-date breakdown">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-stone-500">
          <tr>
            <th className="px-2 py-1">Date</th>
            <th className="px-2 py-1">Quadrats</th>
            <th className="px-2 py-1">Mean foci</th>
            <th className="px-2 py-1">Mean disease %</th>
            <th className="px-2 py-1">Per quadrat</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {groups
            .slice()
            .reverse()
            .map((g) => (
              <tr key={g.date} className="border-t border-stone-100 align-top">
                <td className="px-2 py-2 font-medium">{g.date}</td>
                <td className="px-2 py-2">{g.list.length}</td>
                <td className="px-2 py-2 tabular-nums">{g.meanFoci.toFixed(1)}</td>
                <td className="px-2 py-2 tabular-nums">{g.meanPct.toFixed(1)}%</td>
                <td className="px-2 py-2 text-xs text-stone-600">
                  {g.list.map((p) => (
                    <div key={p.id}>
                      <strong>{p.quadrat_label}:</strong> {p.foci_count} foci,{" "}
                      {p.disease_pct.toFixed(1)}%
                      <a
                        href={p.rectified_image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-blue-600 underline"
                      >
                        image
                      </a>
                      <a
                        href={p.audit_json_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-blue-600 underline"
                      >
                        audit
                      </a>
                    </div>
                  ))}
                </td>
                <td></td>
              </tr>
            ))}
        </tbody>
      </table>
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

// Just here to type the helper above without exporting it.
function groupShape() {
  return [] as Array<{
    date: string;
    list: PhotoAssessment[];
    meanFoci: number;
    meanPct: number;
  }>;
}
