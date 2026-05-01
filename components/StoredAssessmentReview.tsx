"use client";

import { useEffect, useState } from "react";
import type { PhotoAssessment } from "@/lib/airtable";
import type { Focus } from "@/lib/anthropic";
import { RectifiedCanvasView } from "./RectifiedCanvasView";

type AuditJson = {
  parsed?: {
    foci?: Focus[];
    foci_count?: number;
    disease_pct?: number;
    reasoning?: string;
  };
  user_override?: {
    foci?: Focus[];
    foci_count?: number;
    disease_pct?: number;
  } | null;
  prompt_version?: string;
  model_id?: string;
};

export function StoredAssessmentReview({
  assessment,
  onClose,
}: {
  assessment: PhotoAssessment;
  onClose?: () => void;
}) {
  const [audit, setAudit] = useState<AuditJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAudit(null);
    setError(null);
    fetch(assessment.audit_json_url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Audit JSON ${r.status}`);
        return (await r.json()) as AuditJson;
      })
      .then((j) => {
        if (!cancelled) setAudit(j);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [assessment.audit_json_url]);

  // Prefer the user-edited foci if present, else Claude's parsed list.
  const foci: Focus[] | undefined =
    audit?.user_override?.foci ??
    audit?.parsed?.foci ??
    undefined;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {assessment.quadrat_label} — {assessment.photo_date}
          </h3>
          <p className="text-xs text-stone-500">
            {assessment.foci_count} foci · {assessment.disease_pct.toFixed(1)}%
            disease · sensitivity {assessment.sensitivity}
            {audit?.user_override ? " · manually edited" : ""}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Close
          </button>
        )}
      </div>

      {error && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          Could not load audit data: {error}. The image is still shown below.
        </div>
      )}

      <RectifiedCanvasView
        imageUrl={assessment.rectified_image_url}
        foci={foci}
        fociCount={assessment.foci_count}
        diseasePct={assessment.disease_pct}
        maxWidth={520}
        initialMode="foci"
      />

      {audit && (
        <div className="mt-2 text-[11px] text-stone-400">
          Model <code>{audit.model_id ?? "?"}</code> · Prompt{" "}
          <code>{audit.prompt_version ?? "?"}</code>
        </div>
      )}
    </div>
  );
}
