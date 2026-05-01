import { NextResponse } from "next/server";
import { listPhotosForLocation } from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const locationId = url.searchParams.get("locationId");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }
  return jsonRoute(
    async () => ({ photos: await listPhotosForLocation(locationId) }),
    { context: `GET /api/photos?locationId=${locationId}` }
  );
}
