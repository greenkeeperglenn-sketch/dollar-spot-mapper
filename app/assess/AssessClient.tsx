"use client";

import { useEffect, useState } from "react";
import type { Location, PhotoAssessment } from "@/lib/airtable";
import { rectify, canvasToJpegBlob, type CornerSet } from "@/lib/homography";
import {
  AssessEditor,
  type AiResponse,
  type Focus,
  type PriorMeta,
} from "@/components/AssessEditor";
import { ImageDropZone } from "@/components/ImageDropZone";
import { diseasePercentFromFoci } from "@/lib/foci-coverage";
import { PinCanvas } from "./PinCanvas";

type AssessMeta = {
  locationId: string;
  photoDate: string;
  quadratLabel: string;
  exifDate: string | null;
  originalFilename: string;
};

type AssessData = {
  img: HTMLImageElement;
  meta: AssessMeta;
  corners: CornerSet;
  jpegBase64: string;
  forwardCoeffs: number[];
  inverseCoeffs: number[];
  initialFoci: Focus[];
  priorFoci: Focus[] | null;
  priorMeta: PriorMeta | null;
};

type Step =
  | { kind: "idle" }
  | { kind: "loaded"; img: HTMLImageElement; exifDate: string | null; fileName: string }
  | { kind: "pinning"; img: HTMLImageElement; meta: AssessMeta; corners: CornerSet | null }
  | { kind: "assess"; data: AssessData }
  | { kind: "saved"; locationId: string };

const OUTPUT_SIZE = 1000;

export function AssessClient({ locations }: { locations: Location[] }) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    void loadFile(file)
      .then(({ img, exifDate }) => {
        setStep({
          kind: "loaded",
          img,
          exifDate,
          fileName: file.name,
        });
      })
      .catch((e) => setError(`Failed to load image: ${String(e)}`));
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {busy && (
        <div className="rounded border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-700">
          {busy}
        </div>
      )}

      {(step.kind === "pinning" || step.kind === "assess") && (
        <ContextBar
          meta={step.kind === "pinning" ? step.meta : step.data.meta}
          locations={locations}
          onEdit={() => {
            const img =
              step.kind === "pinning" ? step.img : step.data.img;
            const meta =
              step.kind === "pinning" ? step.meta : step.data.meta;
            setStep({
              kind: "loaded",
              img,
              exifDate: meta.exifDate,
              fileName: meta.originalFilename,
            });
          }}
        />
      )}

      {step.kind === "idle" && (
        <ImageDropZone
          onFile={handleFile}
          accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
          hint="Drop or paste a quadrat photo"
          subhint={
            <>
              Paste straight from WhatsApp Web with{" "}
              <kbd className="rounded border border-stone-300 bg-stone-100 px-1 font-mono text-[11px]">
                Ctrl
              </kbd>
              +
              <kbd className="rounded border border-stone-300 bg-stone-100 px-1 font-mono text-[11px]">
                V
              </kbd>{" "}
              (or{" "}
              <kbd className="rounded border border-stone-300 bg-stone-100 px-1 font-mono text-[11px]">
                ⌘
              </kbd>
              +
              <kbd className="rounded border border-stone-300 bg-stone-100 px-1 font-mono text-[11px]">
                V
              </kbd>{" "}
              on Mac), drag a file from a folder, or
            </>
          }
        />
      )}

      {step.kind === "loaded" && (
        <DateAndLocation
          locations={locations}
          fileName={step.fileName}
          img={step.img}
          exifDate={step.exifDate}
          onCancel={() => setStep({ kind: "idle" })}
          onNext={(meta) =>
            setStep({ kind: "pinning", img: step.img, meta, corners: null })
          }
        />
      )}

      {step.kind === "pinning" && (
        <PinningStep
          img={step.img}
          meta={step.meta}
          onBack={() =>
            setStep({
              kind: "loaded",
              img: step.img,
              exifDate: step.meta.exifDate,
              fileName: step.meta.originalFilename,
            })
          }
          onConfirm={async (corners) => {
            setBusy("Rectifying image…");
            try {
              const r = rectify({
                source: step.img,
                corners,
                outputSize: OUTPUT_SIZE,
              });
              const blob = await canvasToJpegBlob(r.canvas, 0.9);
              const jpegBase64 = await blobToBase64(blob);

              // Look up the prior assessment for the same (location, site)
              // before this photo's date, in parallel-ish. Best effort —
              // failures are non-fatal, the operator just gets a blank canvas.
              setBusy("Looking up previous assessment…");
              let priorFoci: Focus[] | null = null;
              let priorMeta: PriorMeta | null = null;
              let initialFoci: Focus[] = [];
              try {
                const url =
                  `/api/assessments/previous?locationId=${step.meta.locationId}` +
                  `&quadrat_label=${encodeURIComponent(step.meta.quadratLabel)}` +
                  `&before=${step.meta.photoDate}`;
                const res = await fetch(url, { cache: "no-store" });
                if (res.ok) {
                  const data = (await res.json()) as {
                    previous: PhotoAssessment | null;
                    foci: Focus[];
                  };
                  if (data.previous) {
                    priorMeta = {
                      id: data.previous.id,
                      date: data.previous.photo_date,
                      foci_count: data.previous.foci_count,
                      disease_pct: data.previous.disease_pct,
                    };
                    priorFoci = data.foci.map((f, i) => ({
                      ...f,
                      id: i + 1,
                    }));
                    // Default behaviour: pre-fill from prior so the operator
                    // adjusts deltas instead of starting from scratch. They
                    // can hit Clear all if they want a blank canvas.
                    initialFoci = priorFoci.map((f) => ({ ...f }));
                  }
                }
              } catch (e) {
                console.warn("previous-assessment fetch failed", e);
              }

              setStep({
                kind: "assess",
                data: {
                  img: step.img,
                  meta: step.meta,
                  corners,
                  jpegBase64,
                  forwardCoeffs: r.forwardCoeffs,
                  inverseCoeffs: r.inverseCoeffs,
                  initialFoci,
                  priorFoci,
                  priorMeta,
                },
              });
            } catch (e) {
              setError(`Rectify failed: ${String(e)}`);
            } finally {
              setBusy(null);
            }
          }}
        />
      )}

      {step.kind === "assess" && (
        <AssessEditor
          jpegBase64={step.data.jpegBase64}
          initialFoci={step.data.initialFoci}
          priorFoci={step.data.priorFoci}
          priorMeta={step.data.priorMeta}
          onBack={() =>
            setStep({
              kind: "pinning",
              img: step.data.img,
              meta: step.data.meta,
              corners: step.data.corners,
            })
          }
          onSave={async ({ foci, notes, aiSnapshot, priorMeta }) => {
            setBusy("Saving to Airtable + Vercel Blob…");
            try {
              const fociCount = foci.length;
              const diseasePct = diseasePercentFromFoci(foci);
              const audit = buildAuditJson({
                meta: step.data.meta,
                corners: step.data.corners,
                imgWidth: step.data.img.naturalWidth,
                imgHeight: step.data.img.naturalHeight,
                forwardCoeffs: step.data.forwardCoeffs,
                inverseCoeffs: step.data.inverseCoeffs,
                aiSnapshot,
                userResult: { foci, foci_count: fociCount, disease_pct: diseasePct },
                priorAssessmentId: priorMeta?.id ?? null,
              });
              const r = await fetch("/api/assessments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  locationId: step.data.meta.locationId,
                  photo_date: step.data.meta.photoDate,
                  quadrat_label: step.data.meta.quadratLabel,
                  sensitivity: aiSnapshot?.prompt?.sensitivity ?? 0,
                  rectifiedJpegBase64: step.data.jpegBase64,
                  audit,
                  result: {
                    foci_count: fociCount,
                    disease_pct: diseasePct,
                    reasoning:
                      aiSnapshot?.result?.reasoning ?? "operator-marked",
                  },
                  notes,
                }),
              });
              if (!r.ok) throw new Error(await r.text());
              setStep({ kind: "saved", locationId: step.data.meta.locationId });
            } catch (e) {
              setError(`Save failed: ${String(e)}`);
            } finally {
              setBusy(null);
            }
          }}
        />
      )}

      {step.kind === "saved" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-sm">
          <h2 className="text-lg font-semibold text-green-900">Saved.</h2>
          <p className="mt-1 text-green-800">
            The rectified image and audit JSON are in Vercel Blob; the
            assessment is in Airtable.
          </p>
          <div className="mt-3 flex gap-3 text-sm">
            <a
              href={`/locations/${step.locationId}`}
              className="rounded bg-green-900 px-3 py-1.5 text-white"
            >
              View location history
            </a>
            <button
              onClick={() => setStep({ kind: "idle" })}
              className="rounded border border-green-300 px-3 py-1.5"
            >
              Assess another photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Sub-steps -----------------------------------------------------------

function ContextBar({
  meta,
  locations,
  onEdit,
}: {
  meta: AssessMeta;
  locations: Location[];
  onEdit: () => void;
}) {
  const loc = locations.find((l) => l.id === meta.locationId);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm">
      <span className="text-xs uppercase tracking-wide text-stone-500">
        Saving to
      </span>
      <span className="font-semibold text-stone-900">
        {loc?.name ?? "(unknown location)"}
      </span>
      <span className="text-stone-400">·</span>
      <span>
        Site: <strong>{meta.quadratLabel}</strong>
      </span>
      <span className="text-stone-400">·</span>
      <span>
        Date: <strong>{meta.photoDate}</strong>
      </span>
      <button
        onClick={onEdit}
        className="ml-auto rounded border border-stone-400 px-2 py-0.5 text-xs hover:bg-white"
      >
        Change
      </button>
    </div>
  );
}

function DateAndLocation({
  locations,
  img,
  exifDate,
  fileName,
  onNext,
  onCancel,
}: {
  locations: Location[];
  img: HTMLImageElement;
  exifDate: string | null;
  fileName: string;
  onNext: (m: AssessMeta) => void;
  onCancel: () => void;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [photoDate, setPhotoDate] = useState(exifDate ?? "");
  const selectedLocation = locations.find((l) => l.id === locationId);
  const sites = selectedLocation?.sites ?? [];
  const [siteSelect, setSiteSelect] = useState<string>("");
  const [customSite, setCustomSite] = useState("");

  useEffect(() => {
    if (sites.length > 0) {
      setSiteSelect(sites[0]);
    } else {
      setSiteSelect("__custom__");
      if (!customSite) setCustomSite("Q1");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const effectiveSite =
    siteSelect === "__custom__" ? customSite.trim() : siteSelect;
  const isValid =
    !!locationId &&
    /^\d{4}-\d{2}-\d{2}$/.test(photoDate) &&
    effectiveSite.length > 0;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const lastMonday = (() => {
    const d = new Date();
    const dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (dow - 1));
    return d.toISOString().slice(0, 10);
  })();

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <ImagePreview img={img} />
        <div className="mt-2 text-xs text-stone-500">
          {fileName} · {img.naturalWidth} × {img.naturalHeight} px
        </div>
      </div>
      <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-stone-600">
            Location
          </label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-600">
            Photo taken on
          </label>
          {exifDate ? (
            <p className="text-xs text-green-700">
              Detected from photo metadata — edit if wrong.
            </p>
          ) : (
            <p className="text-xs text-amber-700">
              No metadata found (typical for WhatsApp). Pick the date.
            </p>
          )}
          <input
            type="date"
            value={photoDate}
            onChange={(e) => setPhotoDate(e.target.value)}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            <QuickDate label="Today" value={today} onPick={setPhotoDate} />
            <QuickDate label="Yesterday" value={yesterday} onPick={setPhotoDate} />
            <QuickDate label="This Mon" value={lastMonday} onPick={setPhotoDate} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-600">
            Site
          </label>
          {sites.length > 0 ? (
            <p className="text-xs text-stone-500">
              Pick one of the saved sites for this location, or choose
              &quot;Other&hellip;&quot; to type an ad-hoc name.
            </p>
          ) : (
            <p className="text-xs text-amber-700">
              No saved sites for this location yet. You can{" "}
              <a href="/locations" className="underline">
                add some on the Locations page
              </a>{" "}
              (e.g. <em>Chipping green</em>, <em>11th tee</em>) so they show up
              here next time.
            </p>
          )}
          <select
            value={siteSelect}
            onChange={(e) => setSiteSelect(e.target.value)}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
          >
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="__custom__">Other / new&hellip;</option>
          </select>
          {siteSelect === "__custom__" && (
            <input
              value={customSite}
              onChange={(e) => setCustomSite(e.target.value)}
              placeholder="e.g. 7th green, North quadrat"
              className="mt-2 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            />
          )}
        </div>

        <div className="flex gap-2">
          <button
            disabled={!isValid}
            onClick={() =>
              onNext({
                locationId,
                photoDate,
                quadratLabel: effectiveSite,
                exifDate,
                originalFilename: fileName,
              })
            }
            className="rounded bg-stone-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Pin corners →
          </button>
          <button
            onClick={onCancel}
            className="rounded border border-stone-300 px-4 py-1.5 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickDate({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className="rounded border border-stone-300 px-2 py-0.5 text-xs hover:bg-stone-50"
    >
      {label}
    </button>
  );
}

function ImagePreview({ img }: { img: HTMLImageElement }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={img.src}
      alt="Photo preview"
      className="max-h-72 w-full rounded object-contain"
    />
  );
}

function PinningStep({
  img,
  meta,
  onBack,
  onConfirm,
}: {
  img: HTMLImageElement;
  meta: AssessMeta;
  onBack: () => void;
  onConfirm: (c: CornerSet) => void;
}) {
  const [corners, setCorners] = useState<Partial<CornerSet>>({});
  const allFour =
    corners.tl && corners.tr && corners.br && corners.bl ? (corners as CornerSet) : null;

  return (
    <div className="space-y-3">
      <div className="rounded border border-stone-200 bg-amber-50 p-3 text-xs text-amber-900">
        <strong>Tap the inside corner of each white L-mark</strong>, in order:
        <span className="mx-1 font-mono">1</span>top-left,
        <span className="mx-1 font-mono">2</span>top-right,
        <span className="mx-1 font-mono">3</span>bottom-right,
        <span className="mx-1 font-mono">4</span>bottom-left. Drag any pin
        afterwards to fine-tune. Use the zoom slider for precision.
      </div>

      <PinCanvas
        img={img}
        corners={corners}
        onChange={setCorners}
        meta={meta}
      />

      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="rounded border border-stone-300 px-4 py-1.5 text-sm"
        >
          ← Back
        </button>
        <button
          onClick={() => setCorners({})}
          className="rounded border border-stone-300 px-4 py-1.5 text-sm"
        >
          Reset pins
        </button>
        <button
          disabled={!allFour}
          onClick={() => allFour && onConfirm(allFour)}
          className="ml-auto rounded bg-stone-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Rectify →
        </button>
      </div>
    </div>
  );
}

// ---- Helpers --------------------------------------------------------------

async function loadFile(
  file: File
): Promise<{ img: HTMLImageElement; exifDate: string | null }> {
  let blob: Blob = file;
  const isHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  if (isHeic) {
    const { heicTo } = await import("heic-to");
    const result = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
    blob = Array.isArray(result) ? result[0] : result;
  }

  let exifDate: string | null = null;
  try {
    const { default: exifr } = await import("exifr");
    const exif = (await exifr.parse(file, [
      "DateTimeOriginal",
      "CreateDate",
      "DateTime",
    ])) as
      | { DateTimeOriginal?: Date; CreateDate?: Date; DateTime?: Date }
      | null
      | undefined;
    const dt = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.DateTime;
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
      exifDate = dt.toISOString().slice(0, 10);
    }
  } catch {
    // exifr can throw on files with no metadata; treat as missing.
  }

  const url = URL.createObjectURL(blob);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = (e) => reject(e);
    i.src = url;
  });
  return { img, exifDate };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const v = r.result;
      if (typeof v === "string") resolve(v.split(",")[1] ?? "");
      else reject(new Error("FileReader returned non-string"));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function buildAuditJson(input: {
  meta: AssessMeta;
  corners: CornerSet;
  imgWidth: number;
  imgHeight: number;
  forwardCoeffs: number[];
  inverseCoeffs: number[];
  aiSnapshot: AiResponse | null;
  userResult: { foci: Focus[]; foci_count: number; disease_pct: number };
  priorAssessmentId: string | null;
}) {
  return {
    timestamp_iso: new Date().toISOString(),
    location_id: input.meta.locationId,
    quadrat_label: input.meta.quadratLabel,
    photo_date: input.meta.photoDate,
    exif_date_detected: input.meta.exifDate,
    original_filename: input.meta.originalFilename,
    corner_points_original_px: {
      tl: [input.corners.tl.x, input.corners.tl.y],
      tr: [input.corners.tr.x, input.corners.tr.y],
      br: [input.corners.br.x, input.corners.br.y],
      bl: [input.corners.bl.x, input.corners.bl.y],
    },
    original_image_dims_px: [input.imgWidth, input.imgHeight],
    rectified_dims_px: [OUTPUT_SIZE, OUTPUT_SIZE],
    rectified_represents_m: [1.0, 1.0],
    homography_forward_coeffs: input.forwardCoeffs,
    homography_inverse_coeffs: input.inverseCoeffs,
    // AI run snapshot (null if the operator never invoked the AI helper).
    model_id: input.aiSnapshot?.modelId ?? null,
    prompt_version: input.aiSnapshot?.prompt.version ?? null,
    prompt_hash: input.aiSnapshot?.prompt.hash ?? null,
    sensitivity_setting: input.aiSnapshot?.prompt.sensitivity ?? null,
    parsed: input.aiSnapshot
      ? {
          foci_count: input.aiSnapshot.result.foci_count,
          foci: input.aiSnapshot.result.foci ?? [],
          disease_pct: input.aiSnapshot.result.disease_pct,
          reasoning: input.aiSnapshot.result.reasoning,
        }
      : null,
    user_override: input.userResult,
    prior_assessment_id: input.priorAssessmentId,
  };
}

export type { AssessMeta };
