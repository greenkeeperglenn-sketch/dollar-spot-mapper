import { listAllPhotos, listLocations } from "@/lib/airtable";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [locations, allPhotos] = await Promise.all([
    listLocations().catch(() => []),
    listAllPhotos().catch(() => []),
  ]);
  const photoCounts: Record<string, number> = {};
  for (const p of allPhotos) {
    photoCounts[p.locationId] = (photoCounts[p.locationId] ?? 0) + 1;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Dollar spot pressure
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          Smith-Kerns logistic-regression probability based on the trailing
          5-day mean temperature and relative humidity.
        </p>
      </div>
      <DashboardClient locations={locations} photoCounts={photoCounts} />
    </div>
  );
}
