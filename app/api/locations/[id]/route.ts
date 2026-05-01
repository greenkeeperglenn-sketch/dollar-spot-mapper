import { NextResponse } from "next/server";
import {
  deleteLocation,
  getLocation,
  updateLocation,
} from "@/lib/airtable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const loc = await getLocation(id);
  if (!loc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ location: loc });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json()) as Partial<{
    name: string;
    latitude: number;
    longitude: number;
    notes: string;
    active: boolean;
  }>;
  const loc = await updateLocation(id, body);
  return NextResponse.json({ location: loc });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteLocation(id);
  return NextResponse.json({ ok: true });
}
