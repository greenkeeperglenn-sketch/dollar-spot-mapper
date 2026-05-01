import { NextResponse } from "next/server";
import {
  createLocation,
  listLocations,
  type Location,
} from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";
import { backfillLocation } from "@/lib/weather-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return jsonRoute(
    async () => ({ locations: await listLocations() }),
    { context: "GET /api/locations" }
  );
}

type CreateBody = {
  name?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  active?: boolean;
  sites?: string[];
};

export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON" },
      { status: 400 }
    );
  }
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

  return jsonRoute(
    async () => {
      const loc: Location = await createLocation({
        name: body.name!,
        latitude: body.latitude!,
        longitude: body.longitude!,
        notes: body.notes,
        active: body.active ?? true,
        sites: body.sites,
      });
      // Fire-and-forget the backfill so the request returns quickly.
      void backfillLocation(loc).catch((err) => {
        console.error(`backfill failed for ${loc.id}`, err);
      });
      return { location: loc, backfillStarted: true };
    },
    { context: "POST /api/locations" }
  );
}
