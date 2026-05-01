import { NextResponse } from "next/server";
import {
  deleteLocation,
  getLocation,
  updateLocation,
} from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return jsonRoute(
    async () => {
      const loc = await getLocation(id);
      if (!loc) throw new Error(`Location ${id} not found`);
      return { location: loc };
    },
    { context: `GET /api/locations/${id}` }
  );
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  let body: Partial<{
    name: string;
    latitude: number;
    longitude: number;
    notes: string;
    active: boolean;
    sites: string[];
  }>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  return jsonRoute(
    async () => ({ location: await updateLocation(id, body) }),
    { context: `PATCH /api/locations/${id}` }
  );
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return jsonRoute(
    async () => {
      await deleteLocation(id);
      return { ok: true };
    },
    { context: `DELETE /api/locations/${id}` }
  );
}
