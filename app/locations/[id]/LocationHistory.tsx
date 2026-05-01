"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Location, PhotoAssessment, PressureScore } from "@/lib/airtable";
import type { ForecastPressureRow } from "@/lib/forecast-pressure";
import { PhotoTrendPanels } from "@/components/PhotoTrendPanels";
import { StoredAssessmentReview } from "@/components/StoredAssessmentReview";
import { groupPhotosByDate } from "@/lib/photo-aggregations";

export function LocationHistory({
  pressure,
  photos,
  forecast = [],
  currentLocationId,
  allLocations = [],
}: {
  pressure: PressureScore[];
  photos: PhotoAssessment[];
  forecast?: ForecastPressureRow[];
  currentLocationId?: string;
  allLocations?: Location[];
}) {
  const groups = groupPhotosByDate(photos);
  return (
    <div className="space-y-6">
      <PressureSection pressure={pressure} forecast={forecast} />
      <PhotoTrendPanels photos={photos} />
      <PhotosTable
        groups={groups}
        currentLocationId={currentLocationId}
        allLocations={allLocations}
      />
    </div>
  );
}

function PressureSection({
  pressure,
  forecast,
}: {
  pressure: PressureScore[];
  forecast: ForecastPressureRow[];
}) {
  if (pressure.length === 0 && forecast.length === 0) {
    return (
      <Card title="Disease pressure">
        <p className="text-sm text-stone-500">
          No pressure data yet. Backfill or wait for the daily cron.
        </p>
      </Card>
    );
  }
  type Row = {
    label: string;
    actual?: number;
    forecast?: number;
  };
  const rows: Row[] = [];
  for (let i = 0; i < pressure.length; i++) {
    const p = pressure[i];
    const isLast = i === pressure.length - 1;
    rows.push({
      label: shortDate(p.date),
      actual: p.smith_kerns_probability,
      ...(isLast && forecast.length > 0
        ? { forecast: p.smith_kerns_probability }
        : {}),
    });
  }
  for (const f of forecast) {
    rows.push({ label: shortDate(f.date), forecast: f.smith_kerns_probability });
  }
  const todayLabel =
    pressure.length > 0 ? shortDate(pressure[pressure.length - 1].date) : null;

  return (
    <Card
      title="Disease pressure (Smith-Kerns)"
      subtitle={`Last 120 days of actuals; next ${forecast.length} days forecast (dashed) from Open-Meteo.`}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 12 }}
          />
          <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
          <Legend />
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
            dataKey="actual"
            name="Actual"
            stroke="#374151"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            name="Forecast"
            stroke="#9ca3af"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

function PhotosTable({
  groups,
  currentLocationId,
  allLocations,
}: {
  groups: ReturnType<typeof groupPhotosByDate>;
  currentLocationId?: string;
  allLocations: Location[];
}) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState<PhotoAssessment | null>(null);
  const [moving, setMoving] = useState<PhotoAssessment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (groups.length === 0) return null;

  const moveTargets = allLocations.filter((l) => l.id !== currentLocationId);

  async function moveTo(p: PhotoAssessment, targetLocationId: string) {
    setBusyId(p.id);
    setError(null);
    try {
      const res = await fetch(`/api/assessments/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: targetLocationId }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      setMoving(null);
      router.refresh();
    } catch (e) {
      setError(`Move failed — ${String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function deletePhoto(p: PhotoAssessment) {
    if (
      !confirm(
        `Delete the ${p.quadrat_label} photo from ${p.photo_date}? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(p.id);
    setError(null);
    try {
      const res = await fetch(`/api/assessments/${p.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      router.refresh();
    } catch (e) {
      setError(`Delete failed — ${String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Card title="Per-date breakdown">
        {error && (
          <div className="mb-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}
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
                <tr
                  key={g.date}
                  className="border-t border-stone-100 align-top"
                >
                  <td className="px-2 py-2 font-medium">{g.date}</td>
                  <td className="px-2 py-2">{g.list.length}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {g.meanFoci.toFixed(1)}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {g.meanPct.toFixed(1)}%
                  </td>
                  <td className="px-2 py-2 text-xs text-stone-600">
                    {g.list.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center gap-2 py-0.5"
                      >
                        <strong>{p.quadrat_label}:</strong>
                        <span>
                          {p.foci_count} foci, {p.disease_pct.toFixed(1)}%
                        </span>
                        <button
                          onClick={() =>
                            setReviewing(reviewing?.id === p.id ? null : p)
                          }
                          disabled={busyId === p.id}
                          className="rounded border border-stone-300 px-2 py-0.5 text-[11px] hover:bg-stone-50 disabled:opacity-40"
                        >
                          {reviewing?.id === p.id ? "Hide" : "View overlay"}
                        </button>
                        <button
                          onClick={() => setMoving(p)}
                          disabled={busyId === p.id || moveTargets.length === 0}
                          title={
                            moveTargets.length === 0
                              ? "No other locations to move to"
                              : "Move this photo to another location"
                          }
                          className="rounded border border-stone-300 px-2 py-0.5 text-[11px] hover:bg-stone-50 disabled:opacity-40"
                        >
                          Move
                        </button>
                        <button
                          onClick={() => deletePhoto(p)}
                          disabled={busyId === p.id}
                          className="rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-40"
                        >
                          {busyId === p.id ? "…" : "Delete"}
                        </button>
                        <a
                          href={p.audit_json_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-blue-600 underline"
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
      {reviewing && (
        <StoredAssessmentReview
          assessment={reviewing}
          onClose={() => setReviewing(null)}
        />
      )}
      {moving && (
        <MoveDialog
          photo={moving}
          targets={moveTargets}
          busy={busyId === moving.id}
          onCancel={() => setMoving(null)}
          onMove={(toId) => moveTo(moving, toId)}
        />
      )}
    </>
  );
}

function MoveDialog({
  photo,
  targets,
  busy,
  onCancel,
  onMove,
}: {
  photo: PhotoAssessment;
  targets: Location[];
  busy: boolean;
  onCancel: () => void;
  onMove: (toLocationId: string) => void;
}) {
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-4 shadow-lg"
      >
        <h3 className="text-sm font-semibold">
          Move {photo.quadrat_label} ({photo.photo_date})
        </h3>
        <p className="mt-1 text-xs text-stone-600">
          The image, audit JSON and the assessment record will all be re-linked
          to the chosen location. Weather and pressure are unaffected.
        </p>
        <label className="mt-3 block text-xs font-medium text-stone-600">
          Move to
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
          >
            {targets.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.active ? "" : " (archived)"}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-stone-300 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            disabled={!target || busy}
            onClick={() => onMove(target)}
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {busy ? "Moving…" : "Move photo"}
          </button>
        </div>
      </div>
    </div>
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
