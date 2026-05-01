import { NextResponse } from "next/server";
import { listPressureForLocation } from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";
import { addDays, todayUTC } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const locationId = url.searchParams.get("locationId");
  const daysParam = url.searchParams.get("days");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }
  const days = daysParam ? Math.max(1, Math.min(365, Number(daysParam))) : 30;
  const since = addDays(todayUTC(), -days);
  return jsonRoute(
    async () => ({
      scores: await listPressureForLocation(locationId, { sinceDate: since }),
    }),
    { context: `GET /api/pressure?locationId=${locationId}` }
  );
}
