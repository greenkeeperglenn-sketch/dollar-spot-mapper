import { NextResponse } from "next/server";
import { listPhotosForLocation, type PhotoAssessment } from "@/lib/airtable";
import { jsonRoute } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Focus = {
  id: number;
  x: number;
  y: number;
  radius_px: number;
  confidence?: "low" | "medium" | "high";
};

type AuditJson = {
  parsed?: { foci?: unknown[] };
  user_override?: { foci?: unknown[] } | null;
};

function parseFoci(raw: unknown): Focus[] {
  if (!Array.isArray(raw)) return [];
  const out: Focus[] = [];
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i] as Partial<Focus> | undefined;
    if (!f) continue;
    const x = Number(f.x);
    const y = Number(f.y);
    const r = Number(f.radius_px);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) continue;
    out.push({
      id: Number.isFinite(Number(f.id)) ? Number(f.id) : i + 1,
      x: Math.round(x),
      y: Math.round(y),
      radius_px: Math.round(r),
      confidence: f.confidence,
    });
  }
  return out;
}

async function fetchAuditFoci(url: string): Promise<Focus[]> {
  if (!url) return [];
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const audit = (await res.json()) as AuditJson;
    // Prefer the user's manually-edited foci if present, else Claude's parsed.
    return parseFoci(audit.user_override?.foci ?? audit.parsed?.foci ?? []);
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const locationId = url.searchParams.get("locationId");
  const quadratLabel = url.searchParams.get("quadrat_label");
  const before = url.searchParams.get("before");
  if (!locationId || !quadratLabel || !before) {
    return NextResponse.json(
      { error: "locationId, quadrat_label, before required" },
      { status: 400 }
    );
  }

  return jsonRoute(
    async () => {
      const all = await listPhotosForLocation(locationId);
      const matching = all
        .filter((p) => (p.quadrat_label || "") === quadratLabel)
        .filter((p) => p.photo_date < before)
        .sort((a, b) => b.photo_date.localeCompare(a.photo_date));
      const prior: PhotoAssessment | null = matching[0] ?? null;
      const foci = prior ? await fetchAuditFoci(prior.audit_json_url) : [];
      return { previous: prior, foci };
    },
    { context: `GET /api/assessments/previous` }
  );
}
