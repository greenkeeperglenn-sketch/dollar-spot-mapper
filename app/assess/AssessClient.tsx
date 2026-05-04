"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Location } from "@/lib/airtable";
import { rectify, canvasToJpegBlob, type CornerSet } from "@/lib/homography";
import { ImageDropZone } from "@/components/ImageDropZone";
import { RectifiedCanvasView } from "@/components/RectifiedCanvasView";
import { diseasePercentFromFoci } from "@/lib/foci-coverage";
import { PinCanvas } from "./PinCanvas";

type Step =
  | { kind: "idle" }
  | { kind: "loaded"; img: HTMLImageElement; exifDate: string | null; fileName: string }
  | { kind: "pinning"; img: HTMLImageElement; meta: AssessMeta; corners: CornerSet | null }
  | {
      kind: "rectified";
      img: HTMLImageElement;
      meta: AssessMeta;
      corners: CornerSet;
      canvas: HTMLCanvasElement;
      jpegBase64: string;
      forwardCoeffs: number[];
      inverseCoeffs: number[];
    }
  | {
      kind: "analysed";
      img: HTMLImageElement;
      meta: AssessMeta;
      corners: CornerSet;
      canvas: HTMLCanvasElement;
      jpegBase64: string;
      forwardCoeffs: number[];
      inverseCoeffs: number[];
      analysis: AnalysisResponse;
    }
  | { kind: "saved"; locationId: string };

type AssessMeta = {
  locationId: string;
  photoDate: string;
  quadratLabel: string;
  exifDate: string | null;
  originalFilename: string;
};

type Focus = {
  id: number;
  x: number;
  y: number;
  radius_px: number;
  confidence?: "low" | "medium" | "high";
};

type AnalysisResponse = {
  result: {
    foci_count: number;
    foci?: Focus[];
    disease_pct: number;
    reasoning: string;
    raw_text?: string;
  };
  prompt: { version: string; hash: string; sensitivity: number };
  modelId: string;
};

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

      {(step.kind === "pinning" ||
        step.kind === "rectified" ||
        step.kind === "analysed") && (
        <ContextBar
          meta={step.meta}
          locations={locations}
          onEdit={() => {
            // Jump back to the loaded step so the user can change the location,
            // site, or date. The loaded image is preserved.
            setStep({
              kind: "loaded",
              img: step.img,
              exifDate: step.meta.exifDate,
              fileName: step.meta.originalFilename,
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
              </kbd>
              {" "}(or{" "}
              <kbd className="rounded border border-stone-300 bg-stone-100 px-1 font-mono text-[11px]">
                ⌘
              </kbd>
              +
              <kbd className="rounded border border-stone-300 bg-stone-100 px-1 font-mono text-[11px]">
                V
              </kbd>
              {" "}on Mac), drag a file from a folder, or
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
              setStep({
                kind: "rectified",
                img: step.img,
                meta: step.meta,
                corners,
                canvas: r.canvas,
                jpegBase64,
                forwardCoeffs: r.forwardCoeffs,
                inverseCoeffs: r.inverseCoeffs,
              });
            } catch (e) {
              setError(`Rectify failed: ${String(e)}`);
            } finally {
              setBusy(null);
            }
          }}
        />
      )}

      {step.kind === "rectified" && (
        <RectifiedStep
          canvas={step.canvas}
          onBack={() =>
            setStep({
              kind: "pinning",
              img: step.img,
              meta: step.meta,
              corners: step.corners,
            })
          }
          onAnalyse={async (sensitivity) => {
            setError(null);
            setBusy(`Asking Claude (sensitivity ${sensitivity})…`);
            try {
              const r = await fetch("/api/analyse", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  imageBase64: step.jpegBase64,
                  sensitivity,
                }),
              });
              if (!r.ok) throw new Error(await r.text());
              const data = (await r.json()) as AnalysisResponse;
              setStep({
                kind: "analysed",
                img: step.img,
                meta: step.meta,
                corners: step.corners,
                canvas: step.canvas,
                jpegBase64: step.jpegBase64,
                forwardCoeffs: step.forwardCoeffs,
                inverseCoeffs: step.inverseCoeffs,
                analysis: data,
              });
            } catch (e) {
              setError(`Analyse failed: ${String(e)}`);
            } finally {
              setBusy(null);
            }
          }}
        />
      )}

      {step.kind === "analysed" && (
        <AnalysedStep
          analysis={step.analysis}
          jpegBase64={step.jpegBase64}
          meta={step.meta}
          onReanalyse={async (sensitivity) => {
            setBusy(`Re-asking Claude (sensitivity ${sensitivity})…`);
            try {
              const r = await fetch("/api/analyse", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  imageBase64: step.jpegBase64,
                  sensitivity,
                }),
              });
              if (!r.ok) throw new Error(await r.text());
              const data = (await r.json()) as AnalysisResponse;
              setStep({ ...step, analysis: data });
            } catch (e) {
              setError(`Re-analyse failed: ${String(e)}`);
            } finally {
              setBusy(null);
            }
          }}
          onSave={async ({ foci, fociCount, diseasePct, notes }) => {
            setBusy("Saving to Airtable + Vercel Blob…");
            try {
              const audit = buildAuditJson({
                meta: step.meta,
                corners: step.corners,
                imgWidth: step.img.naturalWidth,
                imgHeight: step.img.naturalHeight,
                forwardCoeffs: step.forwardCoeffs,
                inverseCoeffs: step.inverseCoeffs,
                modelId: step.analysis.modelId,
                prompt: step.analysis.prompt,
                result: step.analysis.result,
                userOverride: {
                  foci,
                  foci_count: fociCount,
                  disease_pct: diseasePct,
                },
              });
              const r = await fetch("/api/assessments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  locationId: step.meta.locationId,
                  photo_date: step.meta.photoDate,
                  quadrat_label: step.meta.quadratLabel,
                  sensitivity: step.analysis.prompt.sensitivity,
                  rectifiedJpegBase64: step.jpegBase64,
                  audit,
                  result: {
                    foci_count: fociCount,
                    disease_pct: diseasePct,
                    reasoning: step.analysis.result.reasoning,
                  },
                  notes,
                }),
              });
              if (!r.ok) throw new Error(await r.text());
              setStep({ kind: "saved", locationId: step.meta.locationId });
            } catch (e) {
              setError(`Save failed: ${String(e)}`);
            } finally {
              setBusy(null);
            }
          }}
          onBack={() => setStep({ ...step, kind: "rectified" })}
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
  // siteSelect is the dropdown value: a site name from the list, or
  // "__custom__" to enter a free-form label.
  const [siteSelect, setSiteSelect] = useState<string>("");
  const [customSite, setCustomSite] = useState("");

  // When the location changes, reset the chosen site to the first available
  // option for the new location, or to custom if the location has none.
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
  // We have an HTMLImageElement, but its src may be an object URL. Render it
  // directly via an img tag — clone the element rather than re-using because
  // React doesn't track non-React img elements.
  return (
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

function RectifiedStep({
  canvas,
  onBack,
  onAnalyse,
}: {
  canvas: HTMLCanvasElement;
  onBack: () => void;
  onAnalyse: (sensitivity: number) => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [sensitivity, setSensitivity] = useState(3);

  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    host.innerHTML = "";
    const clone = canvas.cloneNode(true) as HTMLCanvasElement;
    clone.getContext("2d")?.drawImage(canvas, 0, 0);
    clone.style.width = "100%";
    clone.style.maxWidth = "500px";
    clone.style.height = "auto";
    clone.style.borderRadius = "0.375rem";
    host.appendChild(clone);
  }, [canvas]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">Rectified 1m × 1m</h2>
        <p className="mb-3 text-xs text-stone-500">
          1000 × 1000 px. Each pixel is 1 mm of real ground.
        </p>
        <div ref={previewRef} />
      </div>
      <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Sensitivity</h2>
        <p className="text-xs text-stone-500">
          1 = strict (only obvious large lesions). 5 = permissive (count faint
          early ones).
        </p>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={sensitivity}
          onChange={(e) => setSensitivity(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-stone-500">
          <span>1 strict</span>
          <span className="font-semibold text-stone-900">{sensitivity}</span>
          <span>5 permissive</span>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={onBack}
            className="rounded border border-stone-300 px-4 py-1.5 text-sm"
          >
            ← Back to pins
          </button>
          <button
            onClick={() => onAnalyse(sensitivity)}
            className="ml-auto rounded bg-stone-900 px-4 py-1.5 text-sm text-white"
          >
            Analyse with Claude →
          </button>
        </div>
      </div>
    </div>
  );
}

function AnalysedStep({
  analysis,
  jpegBase64,
  meta,
  onReanalyse,
  onSave,
  onBack,
}: {
  analysis: AnalysisResponse;
  jpegBase64: string;
  meta: AssessMeta;
  onReanalyse: (s: number) => void;
  onSave: (input: {
    foci: Focus[];
    fociCount: number;
    diseasePct: number;
    notes?: string;
  }) => void;
  onBack: () => void;
}) {
  const [sensitivity, setSensitivity] = useState(analysis.prompt.sensitivity);
  const [notes, setNotes] = useState("");
  const [editedFoci, setEditedFoci] = useState<Focus[]>(
    analysis.result.foci ?? []
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Reset edits whenever a fresh analysis comes in (after re-analyse).
  useEffect(() => {
    setEditedFoci(analysis.result.foci ?? []);
    setSelectedId(null);
  }, [analysis]);

  const editedCount = editedFoci.length;
  const editedPct = useMemo(
    () => diseasePercentFromFoci(editedFoci),
    [editedFoci]
  );

  const wasEdited = !sameFoci(editedFoci, analysis.result.foci ?? []);
  const selectedFocus = editedFoci.find((f) => f.id === selectedId) ?? null;

  function updateSelectedRadius(r: number) {
    if (selectedFocus == null) return;
    setEditedFoci(
      editedFoci.map((f) =>
        f.id === selectedFocus.id ? { ...f, radius_px: r } : f
      )
    );
  }

  function removeSelected() {
    if (selectedId == null) return;
    setEditedFoci(editedFoci.filter((f) => f.id !== selectedId));
    setSelectedId(null);
  }

  function resetToAi() {
    setEditedFoci(analysis.result.foci ?? []);
    setSelectedId(null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">
          Rectified — {meta.quadratLabel} ({meta.photoDate})
        </h2>
        <RectifiedCanvasView
          jpegBase64={jpegBase64}
          foci={editedFoci}
          fociCount={editedCount}
          diseasePct={editedPct}
          maxWidth={520}
          onFociChange={setEditedFoci}
          selectedId={selectedId}
          onSelectChange={setSelectedId}
        />
      </div>
      <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Result</h2>
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label={wasEdited ? "Foci (edited)" : "Foci"}
            value={String(editedCount)}
            sub={
              wasEdited
                ? `Claude said ${analysis.result.foci_count}`
                : undefined
            }
          />
          <Stat
            label={wasEdited ? "Disease % (edited)" : "Disease coverage"}
            value={`${editedPct.toFixed(1)}%`}
            sub={
              wasEdited
                ? `Claude said ${analysis.result.disease_pct.toFixed(1)}%`
                : undefined
            }
          />
        </div>
        <p className="text-xs text-stone-600 leading-relaxed">
          <span className="font-medium">Claude's reasoning:</span>{" "}
          {analysis.result.reasoning || "(none)"}
        </p>
        <div className="text-xs text-stone-400">
          Model: <code>{analysis.modelId}</code> · Prompt:{" "}
          <code>{analysis.prompt.version}</code> · Sensitivity:{" "}
          <code>{analysis.prompt.sensitivity}</code>
        </div>

        <div className="rounded border border-stone-200 bg-stone-50 p-3">
          <h3 className="text-xs font-semibold text-stone-700">Edit</h3>
          {selectedFocus ? (
            <div className="mt-2 space-y-2">
              <div className="text-xs text-stone-600">
                Selected focus: <strong>#{selectedFocus.id}</strong> at (
                {selectedFocus.x}, {selectedFocus.y})
              </div>
              <label className="block text-xs text-stone-600">
                Radius (mm)
                <input
                  type="range"
                  min={3}
                  max={120}
                  step={1}
                  value={selectedFocus.radius_px}
                  onChange={(e) =>
                    updateSelectedRadius(Number(e.target.value))
                  }
                  className="mt-1 w-full"
                />
                <div className="flex justify-between font-mono text-[11px] text-stone-500">
                  <span>3</span>
                  <span>{selectedFocus.radius_px}</span>
                  <span>120</span>
                </div>
              </label>
              <button
                onClick={removeSelected}
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                Remove focus #{selectedFocus.id}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-stone-500">
              Click a focus to adjust its size or remove it. Click empty area
              of the image to add a new focus. Disease grows in concentric
              rings — drag the radius slider as the patches expand.
            </p>
          )}
          {wasEdited && (
            <button
              onClick={resetToAi}
              className="mt-2 rounded border border-stone-300 px-2 py-1 text-xs"
            >
              Reset to Claude's output
            </button>
          )}
        </div>

        <div className="border-t border-stone-200 pt-3">
          <label className="block text-xs font-medium text-stone-600">
            Re-analyse at different sensitivity (clears manual edits)
          </label>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-stone-500">
            <span>1</span>
            <span>{sensitivity}</span>
            <span>5</span>
          </div>
          <button
            onClick={() => onReanalyse(sensitivity)}
            className="mt-2 rounded border border-stone-300 px-3 py-1 text-xs"
          >
            Re-analyse
          </button>
        </div>

        <div className="border-t border-stone-200 pt-3">
          <label className="block text-xs font-medium text-stone-600">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onBack}
            className="rounded border border-stone-300 px-4 py-1.5 text-sm"
          >
            ← Back
          </button>
          <button
            onClick={() =>
              onSave({
                foci: editedFoci,
                fociCount: editedCount,
                diseasePct: editedPct,
                notes: notes || undefined,
              })
            }
            className="ml-auto rounded bg-stone-900 px-4 py-1.5 text-sm text-white"
          >
            Save assessment
          </button>
        </div>
      </div>
    </div>
  );
}

function sameFoci(a: Focus[], b: Focus[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].x !== b[i].x ||
      a[i].y !== b[i].y ||
      a[i].radius_px !== b[i].radius_px
    ) {
      return false;
    }
  }
  return true;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded bg-stone-50 p-2">
      <div className="text-xs uppercase tracking-wide text-stone-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-stone-500">{sub}</div>}
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

  // EXIF detection (parse the original file, not the converted blob, so we
  // get DateTimeOriginal even from HEIC).
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
  modelId: string;
  prompt: { version: string; hash: string; sensitivity: number };
  result: {
    foci_count: number;
    foci?: Focus[];
    disease_pct: number;
    reasoning: string;
  };
  userOverride?: {
    foci: Focus[];
    foci_count: number;
    disease_pct: number;
  } | null;
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
    model_id: input.modelId,
    prompt_version: input.prompt.version,
    prompt_hash: input.prompt.hash,
    sensitivity_setting: input.prompt.sensitivity,
    parsed: {
      foci_count: input.result.foci_count,
      foci: input.result.foci ?? [],
      disease_pct: input.result.disease_pct,
      reasoning: input.result.reasoning,
    },
    user_override: input.userOverride ?? null,
  };
}

export type { AssessMeta };
