import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import {
  deletePhotoAssessment,
  getLocation,
  getPhotoAssessment,
  updatePhotoAssessment,
} from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  let body: Partial<{
    locationId: string;
    quadrat_label: string;
    notes: string;
  }>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  return jsonRoute(
    async () => {
      // If moving to a different location, sanity-check that the location
      // exists. This avoids landing the photo in an orphan link.
      if (body.locationId) {
        const loc = await getLocation(body.locationId);
        if (!loc) throw new Error(`Target location ${body.locationId} not found`);
      }
      const updated = await updatePhotoAssessment(id, body);
      return { assessment: updated };
    },
    { context: `PATCH /api/assessments/${id}` }
  );
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;

  return jsonRoute(
    async () => {
      const photo = await getPhotoAssessment(id);
      if (!photo) {
        // Already gone: treat as success so the UI can refresh cleanly.
        return { ok: true, alreadyGone: true };
      }
      // Delete the Airtable row first; if blob cleanup fails afterward we
      // still return success but log a warning. The orphan blobs cost
      // pennies; the row was the user-visible thing.
      await deletePhotoAssessment(id);

      const failures: string[] = [];
      for (const url of [photo.rectified_image_url, photo.audit_json_url]) {
        if (!url) continue;
        try {
          await del(url);
        } catch (err) {
          console.warn(`Blob delete failed for ${url}`, err);
          failures.push(url);
        }
      }

      return { ok: true, blobDeleteFailures: failures };
    },
    { context: `DELETE /api/assessments/${id}` }
  );
}
