import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getLocation,
  listLocations,
  listPhotosForLocation,
  listPressureForLocation,
} from "@/lib/airtable";
import { addDays, todayUTC } from "@/lib/dates";
import { computeForecastPressure } from "@/lib/forecast-pressure";
import { LocationHistory } from "./LocationHistory";

export const dynamic = "force-dynamic";

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loc = await getLocation(id);
  if (!loc) notFound();

  const since = addDays(todayUTC(), -120);
  const [pressure, photos, forecast, allLocations] = await Promise.all([
    listPressureForLocation(id, { sinceDate: since }).catch(() => []),
    listPhotosForLocation(id).catch(() => []),
    computeForecastPressure(loc, 14).catch(() => []),
    listLocations().catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{loc.name}</h1>
          <p className="text-sm text-stone-600">
            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
            {loc.notes ? <> · {loc.notes}</> : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/assess"
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white"
          >
            Assess a photo
          </Link>
          <Link
            href="/locations"
            className="rounded border border-stone-300 px-3 py-1.5 text-sm"
          >
            All locations
          </Link>
        </div>
      </div>

      <LocationHistory
        pressure={pressure}
        photos={photos}
        forecast={forecast}
        currentLocationId={loc.id}
        allLocations={allLocations}
      />
    </div>
  );
}
