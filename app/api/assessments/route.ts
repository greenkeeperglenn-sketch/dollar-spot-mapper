import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { createPhotoAssessment, getLocation } from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  locationId: string;
  photo_date: string; // YYYY-MM-DD
  quadrat_label: string;
  sensitivity: number;
  rectifiedJpegBase64: string;
  audit: Record<string, unknown>;
  result: { foci_count: number; disease_pct: number; reasoning?: string };
  notes?: string;
};

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body.locationId || !body.photo_date || !isIsoDate(body.photo_date)) {
    return NextResponse.json(
      { error: "locationId and photo_date (YYYY-MM-DD) required" },
      { status: 400 }
    );
  }
  if (!body.rectifiedJpegBase64) {
    return NextResponse.json(
      { error: "rectifiedJpegBase64 required" },
      { status: 400 }
    );
  }

  return jsonRoute(
    async () => {
      const loc = await getLocation(body.locationId);
      if (!loc) throw new Error(`Location ${body.locationId} not found`);

      const safeLabel =
        body.quadrat_label.replace(/[^A-Za-z0-9_-]/g, "_") || "Q1";
      const baseKey = `locations/${loc.id}/${body.photo_date}-${safeLabel}`;

      const stripped = body.rectifiedJpegBase64.replace(
        /^data:image\/[a-z]+;base64,/,
        ""
      );
      const jpegBytes = Buffer.from(stripped, "base64");

      const jpegBlob = await put(`${baseKey}-rectified.jpg`, jpegBytes, {
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: true,
      });

      const auditWithBlob = {
        ...body.audit,
        rectified_image_url: jpegBlob.url,
        saved_at_iso: new Date().toISOString(),
      };
      const auditBlob = await put(
        `${baseKey}-audit.json`,
        JSON.stringify(auditWithBlob, null, 2),
        {
          access: "public",
          contentType: "application/json",
          addRandomSuffix: true,
        }
      );

      const row = await createPhotoAssessment({
        locationId: loc.id,
        photo_date: body.photo_date,
        quadrat_label: body.quadrat_label,
        rectified_image_url: jpegBlob.url,
        audit_json_url: auditBlob.url,
        foci_count: body.result.foci_count,
        disease_pct: body.result.disease_pct,
        sensitivity: body.sensitivity,
        notes: body.notes,
      });

      return { assessment: row };
    },
    { context: "POST /api/assessments" }
  );
}
