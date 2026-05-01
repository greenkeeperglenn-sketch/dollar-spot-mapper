import { NextResponse } from "next/server";
import { getLocation } from "@/lib/airtable";
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
  const loc = await getLocation(locationId);
  if (!loc) {
    return NextResponse.json({ error: "location not found" }, { status: 404 });
  }
  const summary = await backfillLocation(loc);
  return NextResponse.json(summary);
}
