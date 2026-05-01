"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PhotoAssessment, PressureScore } from "@/lib/airtable";
import { PhotoTrendPanels } from "@/components/PhotoTrendPanels";
import { groupPhotosByDate } from "@/lib/photo-aggregations";

export function LocationHistory({
  pressure,
  photos,
}: {
  pressure: PressureScore[];
  photos: PhotoAssessment[];
}) {
  const groups = groupPhotosByDate(photos);
  return (
    <div className="space-y-6">
      <PressureSection pressure={pressure} />
      <PhotoTrendPanels photos={photos} />
      <PhotosTable groups={groups} />
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

function PhotosTable({
  groups,
}: {
  groups: ReturnType<typeof groupPhotosByDate>;
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
