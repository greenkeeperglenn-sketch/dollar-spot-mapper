import { NextResponse } from "next/server";
import { getLocation } from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";
import { backfillLocation } from "@/lib/weather-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // backfill can take a while for many days

export async function POST(req: Request) {
  const url = new URL(req.url);
  const locationId = url.searchParams.get("locationId");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }
  return jsonRoute(
    async () => {
      const loc = await getLocation(locationId);
      if (!loc) throw new Error(`Location ${locationId} not found`);
      return await backfillLocation(loc);
    },
    { context: `POST /api/weather/backfill?locationId=${locationId}` }
  );
}
