import { NextResponse } from "next/server";
import { del, put } from "@vercel/blob";
import { getLocation, updateLocation } from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type PostBody = {
  imageBase64?: string;
  filename?: string;
  contentType?: string;
};

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body.imageBase64) {
    return NextResponse.json(
      { error: "imageBase64 required" },
      { status: 400 }
    );
  }
  const ct = (body.contentType ?? "image/png").toLowerCase();
  if (!ALLOWED_TYPES.has(ct)) {
    return NextResponse.json(
      { error: `Unsupported content type ${ct}` },
      { status: 400 }
    );
  }

  return jsonRoute(
    async () => {
      const loc = await getLocation(id);
      if (!loc) throw new Error(`Location ${id} not found`);

      const stripped = body.imageBase64!.replace(
        /^data:image\/[a-z+]+;base64,/,
        ""
      );
      const bytes = Buffer.from(stripped, "base64");

      const ext =
        ct === "image/svg+xml"
          ? "svg"
          : ct.startsWith("image/")
            ? ct.split("/")[1]
            : "png";
      const safeBase = (body.filename ?? "logo")
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^A-Za-z0-9_-]/g, "_") || "logo";
      const blob = await put(
        `locations/${loc.id}/${safeBase}.${ext}`,
        bytes,
        {
          access: "public",
          contentType: ct,
          addRandomSuffix: true,
        }
      );

      // Try to clean up the previous logo blob now that we've replaced it.
      // Failure is non-fatal — the new URL is already saved on the row.
      if (loc.logo_url) {
        try {
          await del(loc.logo_url);
        } catch (e) {
          console.warn(
            `Failed to delete previous logo for ${loc.id}: ${
              e instanceof Error ? e.message : e
            }`
          );
        }
      }

      const updated = await updateLocation(loc.id, { logo_url: blob.url });
      return { location: updated };
    },
    { context: `POST /api/locations/${id}/logo` }
  );
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return jsonRoute(
    async () => {
      const loc = await getLocation(id);
      if (!loc) throw new Error(`Location ${id} not found`);
      if (loc.logo_url) {
        try {
          await del(loc.logo_url);
        } catch (e) {
          console.warn(`Failed to delete blob for ${loc.id}`, e);
        }
      }
      const updated = await updateLocation(loc.id, { logo_url: null });
      return { location: updated };
    },
    { context: `DELETE /api/locations/${id}/logo` }
  );
}
