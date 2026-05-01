"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Location } from "@/lib/airtable";

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
    const payload = {
      name: String(form.get("name") ?? "").trim(),
      latitude: Number(form.get("latitude")),
      longitude: Number(form.get("longitude")),
      notes: String(form.get("notes") ?? "").trim() || undefined,
      active: form.get("active") === "on",
    };
    const res = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setError(`Create failed: ${await res.text()}`);
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
      setError(`Update failed: ${await res.text()}`);
      return;
    }
    setEditingId(null);
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this location? Weather and pressure history stay.")) return;
    const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(`Delete failed: ${await res.text()}`);
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
      setError(`Backfill failed: ${await res.text()}`);
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
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-stone-500">
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
  });
  return (
    <td colSpan={5} className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-40 rounded border border-stone-300 px-2 py-1 text-sm"
        />
        <input
          type="number"
          step="any"
          value={form.latitude}
          onChange={(e) =>
            setForm({ ...form, latitude: Number(e.target.value) })
          }
          className="w-28 rounded border border-stone-300 px-2 py-1 text-sm"
        />
        <input
          type="number"
          step="any"
          value={form.longitude}
          onChange={(e) =>
            setForm({ ...form, longitude: Number(e.target.value) })
          }
          className="w-28 rounded border border-stone-300 px-2 py-1 text-sm"
        />
        <input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="flex-1 min-w-40 rounded border border-stone-300 px-2 py-1 text-sm"
          placeholder="notes"
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          active
        </label>
        <button
          onClick={() => onSave(form)}
          className="rounded bg-stone-900 px-3 py-1 text-sm text-white"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-stone-300 px-3 py-1 text-sm"
        >
          Cancel
        </button>
      </div>
    </td>
  );
}
