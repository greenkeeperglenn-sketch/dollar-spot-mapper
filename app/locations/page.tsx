import { listLocations } from "@/lib/airtable";
import { LocationsClient } from "./LocationsClient";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const locations = await listLocations().catch(() => []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
        <p className="mt-1 text-sm text-stone-600">
          Up to 20 sites. Weather data is fetched daily from Open-Meteo and
          back-filled from 1 March on first save.
        </p>
      </div>
      <LocationsClient initial={locations} />
    </div>
  );
}
