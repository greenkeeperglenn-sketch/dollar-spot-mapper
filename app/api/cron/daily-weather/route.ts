import { NextResponse } from "next/server";
import { listActiveLocations } from "@/lib/airtable";
import { ingestYesterday } from "@/lib/weather-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

async function run(): Promise<NextResponse> {
  const locations = await listActiveLocations();
  const summaries = [];
  for (const loc of locations) {
    try {
      summaries.push(await ingestYesterday(loc));
    } catch (err) {
      console.error(`ingest failed for ${loc.id}`, err);
      summaries.push({ locationId: loc.id, error: String(err) });
    }
  }
  return NextResponse.json({ summaries });
}

// Vercel Cron always uses GET. Keep POST too for manual curl tests.
export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  return run();
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  return run();
}
