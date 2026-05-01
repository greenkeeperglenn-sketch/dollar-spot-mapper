import { NextResponse } from "next/server";
import {
  createLocation,
  listLocations,
  type Location,
} from "@/lib/airtable";
import { backfillLocation } from "@/lib/weather-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await listLocations();
  return NextResponse.json({ locations: rows });
}

type CreateBody = {
  name?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  active?: boolean;
};

export async function POST(req: Request) {
  const body = (await req.json()) as CreateBody;
  if (
    !body.name ||
    typeof body.latitude !== "number" ||
    typeof body.longitude !== "number"
  ) {
    return NextResponse.json(
      { error: "name, latitude, longitude required" },
      { status: 400 }
    );
  }
  const loc: Location = await createLocation({
    name: body.name,
    latitude: body.latitude,
    longitude: body.longitude,
    notes: body.notes,
    active: body.active ?? true,
  });

  // Fire-and-forget the backfill so the request returns quickly.
  // Errors are logged; the user can re-run via the locations page if needed.
  void backfillLocation(loc).catch((err) => {
    console.error(`backfill failed for ${loc.id}`, err);
  });

  return NextResponse.json({ location: loc, backfillStarted: true });
}
