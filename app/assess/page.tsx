import Link from "next/link";
import { listLocations } from "@/lib/airtable";
import { AssessClient } from "./AssessClient";

export const dynamic = "force-dynamic";

export default async function AssessPage() {
  const locations = (await listLocations().catch(() => [])).filter((l) => l.active);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Photo assessment
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          Upload a quadrat photo, pin its four corners, and Claude will count
          the dollar spot infection points in the rectified 1m × 1m image.
        </p>
      </div>
      {locations.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          No active locations.{" "}
          <Link href="/locations" className="underline">
            Create one
          </Link>{" "}
          first.
        </div>
      ) : (
        <AssessClient locations={locations} />
      )}
    </div>
  );
}
