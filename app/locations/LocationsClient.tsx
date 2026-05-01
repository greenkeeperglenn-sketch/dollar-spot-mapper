"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Location } from "@/lib/airtable";

async function readError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: string; where?: string };
    if (j.error) return j.where ? `${j.error} (${j.where})` : j.error;
  } catch {
    // not JSON
  }
  return text.slice(0, 500) || `${fallback} (HTTP ${res.status})`;
}

export function LocationsClient({ initial }: { initial: Location[] }) {
  const [locations, setLocations] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/locations", { cache: "no-store" });
    const data = await res.json();
    setLocations(data.locations as Location[]);
  }

  async function handleCreate(form: FormData) {
    setError(null);
    const sitesRaw = String(form.get("sites") ?? "");
    const payload = {
      name: String(form.get("name") ?? "").trim(),
      latitude: Number(form.get("latitude")),
      longitude: Number(form.get("longitude")),
      notes: String(form.get("notes") ?? "").trim() || undefined,
      active: form.get("active") === "on",
      sites: parseSitesText(sitesRaw),
    };
    const res = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setError(`Create failed — ${await readError(res, "Create failed")}`);
      return;
    }
    await refresh();
    startTransition(() => router.refresh());
  }

  async function handleUpdate(id: string, patch: Partial<Location>) {
    const res = await fetch(`/api/locations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setError(`Update failed — ${await readError(res, "Update failed")}`);
      return;
    }
    setEditingId(null);
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this location? Weather and pressure history stay.")) return;
    const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(`Delete failed — ${await readError(res, "Delete failed")}`);
      return;
    }
    await refresh();
  }

  async function backfillNow(id: string) {
    setError(null);
    const res = await fetch(`/api/weather/backfill?locationId=${id}`, {
      method: "POST",
    });
    if (!res.ok) {
      setError(`Backfill failed — ${await readError(res, "Backfill failed")}`);
      return;
    }
    const summary = await res.json();
    alert(
      `Fetched ${summary.daysFetched} days, wrote ${summary.pressureRowsWritten} pressure rows.`
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <form
        action={handleCreate}
        className="grid grid-cols-1 gap-3 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-6"
      >
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-stone-600">Name</label>
          <input
            name="name"
            required
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            placeholder="Ganton G3"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600">Latitude</label>
          <input
            name="latitude"
            type="number"
            step="any"
            required
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            placeholder="54.150"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600">Longitude</label>
          <input
            name="longitude"
            type="number"
            step="any"
            required
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            placeholder="-0.460"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-stone-600">Notes</label>
          <input
            name="notes"
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            placeholder="optional"
          />
        </div>
        <div className="col-span-full">
          <label className="block text-xs font-medium text-stone-600">
            Sites at this location
          </label>
          <p className="text-xs text-stone-500">
            One per line. These appear in the Assess-photo dropdown for this
            location (e.g. <code>Chipping green</code>, <code>11th tee</code>,
            <code>Practice green</code>). Leave blank to use ad-hoc names.
          </p>
          <textarea
            name="sites"
            rows={3}
            placeholder={"Chipping green\n11th tee\nPractice green"}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs"
          />
        </div>
        <label className="col-span-full flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked /> Active (included in
          daily cron)
        </label>
        <div className="col-span-full">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Add location
          </button>
          <span className="ml-3 text-xs text-stone-500">
            Backfill from 1&nbsp;March runs automatically in the background.
          </span>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Lat / Lon</th>
              <th className="px-3 py-2">Sites</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-stone-500">
                  No locations yet. Add one above.
                </td>
              </tr>
            )}
            {locations.map((loc) => (
              <tr key={loc.id} className="border-t border-stone-100">
                {editingId === loc.id ? (
                  <EditRow loc={loc} onSave={(p) => handleUpdate(loc.id, p)} onCancel={() => setEditingId(null)} />
                ) : (
                  <>
                    <td className="px-3 py-2 font-medium">{loc.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-stone-600">
                      {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-xs text-stone-700">
                      {loc.sites.length === 0 ? (
                        <span className="text-stone-400">—</span>
                      ) : (
                        <span>
                          {loc.sites.slice(0, 3).join(", ")}
                          {loc.sites.length > 3 ? `, +${loc.sites.length - 3} more` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {loc.active ? (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                          active
                        </span>
                      ) : (
                        <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                          archived
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-stone-600">{loc.notes ?? ""}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => backfillNow(loc.id)}
                        className="mr-2 rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
                      >
                        Fetch weather now
                      </button>
                      <button
                        onClick={() => setEditingId(loc.id)}
                        className="mr-2 rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(loc.id)}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditRow({
  loc,
  onSave,
  onCancel,
}: {
  loc: Location;
  onSave: (p: Partial<Location>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: loc.name,
    latitude: loc.latitude,
    longitude: loc.longitude,
    notes: loc.notes ?? "",
    active: loc.active,
    sitesText: loc.sites.join("\n"),
  });
  return (
    <td colSpan={6} className="px-3 py-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded border border-stone-300 px-2 py-1 text-sm sm:col-span-3"
          placeholder="name"
        />
        <input
          type="number"
          step="any"
          value={form.latitude}
          onChange={(e) =>
            setForm({ ...form, latitude: Number(e.target.value) })
          }
          className="rounded border border-stone-300 px-2 py-1 text-sm sm:col-span-2"
          placeholder="latitude"
        />
        <input
          type="number"
          step="any"
          value={form.longitude}
          onChange={(e) =>
            setForm({ ...form, longitude: Number(e.target.value) })
          }
          className="rounded border border-stone-300 px-2 py-1 text-sm sm:col-span-2"
          placeholder="longitude"
        />
        <input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="rounded border border-stone-300 px-2 py-1 text-sm sm:col-span-4"
          placeholder="notes"
        />
        <label className="flex items-center gap-1 text-sm sm:col-span-1">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          active
        </label>
        <div className="sm:col-span-12">
          <label className="block text-xs font-medium text-stone-600">
            Sites (one per line)
          </label>
          <textarea
            rows={3}
            value={form.sitesText}
            onChange={(e) => setForm({ ...form, sitesText: e.target.value })}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs"
            placeholder={"Chipping green\n11th tee\nPractice green"}
          />
        </div>
        <div className="sm:col-span-12 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-stone-300 px-3 py-1 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                name: form.name,
                latitude: form.latitude,
                longitude: form.longitude,
                notes: form.notes,
                active: form.active,
                sites: parseSitesText(form.sitesText),
              })
            }
            className="rounded bg-stone-900 px-3 py-1 text-sm text-white"
          >
            Save
          </button>
        </div>
      </div>
    </td>
  );
}

function parseSitesText(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
