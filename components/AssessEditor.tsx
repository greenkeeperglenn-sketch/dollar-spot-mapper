"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { diseasePercentFromFoci } from "@/lib/foci-coverage";

export type Focus = {
  id: number;
  x: number;
  y: number;
  radius_px: number;
  confidence?: "low" | "medium" | "high";
};

export type AiResponse = {
  result: {
    foci_count: number;
    foci?: Focus[];
    disease_pct: number;
    reasoning: string;
  };
  prompt: { version: string; hash: string; sensitivity: number };
  modelId: string;
};

export type PriorMeta = {
  id: string;
  date: string;
  foci_count: number;
  disease_pct: number;
};

type Tool = "mark" | "brush" | "erase";

const DEFAULT_NEW_RADIUS = 18;
const BRUSH_RADIUS = 18;
const BRUSH_MIN_DISTANCE = 26; // mm between dots while brushing
const MAX_FOCUS_RADIUS = 300; // mm — quarter-image area is ~282mm radius
const MAGNIFIER_RADIUS = 90;
const MAGNIFIER_ZOOM = 5;

export function AssessEditor({
  jpegBase64,
  initialFoci,
  priorFoci,
  priorMeta,
  onSave,
  onBack,
}: {
  jpegBase64: string;
  initialFoci: Focus[];
  priorFoci?: Focus[] | null;
  priorMeta?: PriorMeta | null;
  onSave: (input: {
    foci: Focus[];
    notes?: string;
    aiSnapshot: AiResponse | null;
    priorMeta: PriorMeta | null;
  }) => void;
  onBack: () => void;
}) {
  const [tool, setTool] = useState<Tool>("mark");
  const [foci, setFoci] = useState<Focus[]>(initialFoci);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showPriorGhost, setShowPriorGhost] = useState(true);
  const [scaleAll, setScaleAll] = useState(1);
  const [scaleAllBase, setScaleAllBase] = useState<Focus[] | null>(null);
  const [notes, setNotes] = useState("");

  // AI helper state
  const [aiSensitivity, setAiSensitivity] = useState(3);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Focus[]>([]);
  const [aiSnapshot, setAiSnapshot] = useState<AiResponse | null>(null);

  // SVG ref + interaction state
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{
    id: number;
    offX: number;
    offY: number;
  } | null>(null);
  const [brushing, setBrushing] = useState<{
    lastX: number;
    lastY: number;
  } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  // Image element for magnifier rendering (loaded once from the base64).
  const sourceImgRef = useRef<HTMLImageElement | null>(null);
  const [sourceImgReady, setSourceImgReady] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      sourceImgRef.current = img;
      setSourceImgReady(true);
    };
    img.src = `data:image/jpeg;base64,${jpegBase64}`;
  }, [jpegBase64]);

  const editedCount = foci.length;
  const editedPct = useMemo(() => diseasePercentFromFoci(foci), [foci]);

  const priorPct = useMemo(
    () =>
      priorFoci && priorFoci.length > 0
        ? diseasePercentFromFoci(priorFoci)
        : 0,
    [priorFoci]
  );

  function nextId(): number {
    return foci.length === 0
      ? 1
      : Math.max(...foci.map((f) => f.id), 0) + 1;
  }

  function svgToCoords(e: { clientX: number; clientY: number }): {
    x: number;
    y: number;
  } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    return { x: clamp(x, 0, 1000), y: clamp(y, 0, 1000) };
  }

  function findFocusAt(p: { x: number; y: number }): Focus | null {
    // Walk in reverse (top-rendered first).
    for (let i = foci.length - 1; i >= 0; i--) {
      const f = foci[i];
      const dx = p.x - f.x;
      const dy = p.y - f.y;
      if (dx * dx + dy * dy <= f.radius_px * f.radius_px) return f;
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent) {
    const coords = svgToCoords(e);
    if (!coords) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    if (tool === "erase") {
      const hit = findFocusAt(coords);
      if (hit) {
        setFoci(foci.filter((f) => f.id !== hit.id));
        if (selectedId === hit.id) setSelectedId(null);
      }
      return;
    }

    if (tool === "brush") {
      const newFocus: Focus = {
        id: nextId(),
        x: Math.round(coords.x),
        y: Math.round(coords.y),
        radius_px: BRUSH_RADIUS,
      };
      setFoci([...foci, newFocus]);
      setBrushing({ lastX: coords.x, lastY: coords.y });
      return;
    }

    // mark mode
    const hit = findFocusAt(coords);
    if (hit) {
      setSelectedId(hit.id);
      setDragging({
        id: hit.id,
        offX: coords.x - hit.x,
        offY: coords.y - hit.y,
      });
    } else {
      const id = nextId();
      const newFocus: Focus = {
        id,
        x: Math.round(coords.x),
        y: Math.round(coords.y),
        radius_px: DEFAULT_NEW_RADIUS,
      };
      setFoci([...foci, newFocus]);
      setSelectedId(id);
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const coords = svgToCoords(e);
    if (!coords) return;
    setHover(coords);

    if (tool === "brush" && brushing) {
      const dx = coords.x - brushing.lastX;
      const dy = coords.y - brushing.lastY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= BRUSH_MIN_DISTANCE) {
        setFoci((prev) => [
          ...prev,
          {
            id:
              prev.length === 0
                ? 1
                : Math.max(...prev.map((f) => f.id), 0) + 1,
            x: Math.round(coords.x),
            y: Math.round(coords.y),
            radius_px: BRUSH_RADIUS,
          },
        ]);
        setBrushing({ lastX: coords.x, lastY: coords.y });
      }
      return;
    }

    if (dragging) {
      setFoci((prev) =>
        prev.map((f) =>
          f.id === dragging.id
            ? {
                ...f,
                x: Math.round(coords.x - dragging.offX),
                y: Math.round(coords.y - dragging.offY),
              }
            : f
        )
      );
    }
  }

  function handlePointerUp() {
    setDragging(null);
    setBrushing(null);
  }

  // Keyboard delete
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (selectedId == null) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        setFoci((prev) => prev.filter((f) => f.id !== selectedId));
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // ---- Side panel actions ------------------------------------------------

  const selectedFocus = foci.find((f) => f.id === selectedId) ?? null;

  function updateSelectedRadius(r: number) {
    if (selectedFocus == null) return;
    setFoci((prev) =>
      prev.map((f) =>
        f.id === selectedFocus.id ? { ...f, radius_px: r } : f
      )
    );
  }

  function removeSelected() {
    if (selectedId == null) return;
    setFoci((prev) => prev.filter((f) => f.id !== selectedId));
    setSelectedId(null);
  }

  function clearAll() {
    if (foci.length === 0) return;
    if (!confirm(`Remove all ${foci.length} foci?`)) return;
    setFoci([]);
    setSelectedId(null);
    setScaleAll(1);
    setScaleAllBase(null);
  }

  function startScaleAll() {
    if (scaleAllBase) return;
    setScaleAllBase(foci);
    setScaleAll(1);
  }
  function applyScaleAll() {
    if (!scaleAllBase) return;
    setFoci(
      scaleAllBase.map((f) => ({
        ...f,
        radius_px: Math.max(2, Math.round(f.radius_px * scaleAll)),
      }))
    );
    setScaleAllBase(null);
    setScaleAll(1);
  }
  function cancelScaleAll() {
    if (!scaleAllBase) return;
    setFoci(scaleAllBase);
    setScaleAllBase(null);
    setScaleAll(1);
  }

  // Live preview of scale-all: while scaleAllBase is set and slider != 1,
  // visually show foci scaled but don't bake until Apply.
  const previewFoci: Focus[] = useMemo(() => {
    if (!scaleAllBase) return foci;
    return scaleAllBase.map((f) => ({
      ...f,
      radius_px: Math.max(2, Math.round(f.radius_px * scaleAll)),
    }));
  }, [foci, scaleAllBase, scaleAll]);

  const previewPct = useMemo(
    () => diseasePercentFromFoci(previewFoci),
    [previewFoci]
  );

  // ---- AI helper ---------------------------------------------------------

  async function getAiSuggestion() {
    setAiBusy(true);
    setAiError(null);
    setAiSuggestions([]);
    try {
      const res = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: jpegBase64,
          sensitivity: aiSensitivity,
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as AiResponse;
      setAiSnapshot(data);
      // Re-id the suggestions so they don't collide with operator foci.
      const start = nextId() + 1000;
      const suggestions: Focus[] = (data.result.foci ?? []).map((f, i) => ({
        ...f,
        id: start + i,
      }));
      setAiSuggestions(suggestions);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  function acceptAiSuggestion(s: Focus) {
    const id = nextId();
    setFoci([
      ...foci,
      { id, x: s.x, y: s.y, radius_px: s.radius_px, confidence: s.confidence },
    ]);
    setAiSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  }
  function dismissAiSuggestion(s: Focus) {
    setAiSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  }
  function acceptAllAi() {
    let nextStartId =
      foci.length === 0 ? 1 : Math.max(...foci.map((f) => f.id), 0) + 1;
    const merged = [
      ...foci,
      ...aiSuggestions.map((s) => ({
        id: nextStartId++,
        x: s.x,
        y: s.y,
        radius_px: s.radius_px,
        confidence: s.confidence,
      })),
    ];
    setFoci(merged);
    setAiSuggestions([]);
  }
  function dismissAllAi() {
    setAiSuggestions([]);
  }

  // ---- Save --------------------------------------------------------------

  function handleSave() {
    onSave({
      foci,
      notes: notes || undefined,
      aiSnapshot,
      priorMeta: priorMeta ?? null,
    });
  }

  // ---- Diff vs prior -----------------------------------------------------

  const fociDiff = priorMeta ? editedCount - priorMeta.foci_count : null;
  const pctDiff = priorMeta ? editedPct - priorMeta.disease_pct : null;

  // ---- Render ------------------------------------------------------------

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Canvas column */}
      <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
        {priorMeta && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <span>
              <strong>Last visit ({priorMeta.date}):</strong>{" "}
              {priorMeta.foci_count} foci · {priorMeta.disease_pct.toFixed(1)}%
              coverage. Pre-filled below — adjust as you see now.
            </span>
            <button
              type="button"
              onClick={() => {
                setFoci([]);
                setSelectedId(null);
                setScaleAll(1);
                setScaleAllBase(null);
              }}
              className="rounded border border-blue-300 bg-white px-2 py-0.5 text-[11px] font-medium text-blue-900 hover:bg-blue-100"
            >
              Start blank instead
            </button>
            <label className="ml-auto inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={showPriorGhost}
                onChange={(e) => setShowPriorGhost(e.target.checked)}
              />
              Show ghost
            </label>
          </div>
        )}

        <div
          className="relative inline-block w-full overflow-hidden rounded border border-stone-200"
          style={{ maxWidth: 600 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/jpeg;base64,${jpegBase64}`}
            alt="Rectified quadrat"
            className="block w-full select-none"
            draggable={false}
          />
          <svg
            ref={svgRef}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={() => setHover(null)}
            style={{
              cursor:
                tool === "erase"
                  ? "not-allowed"
                  : tool === "brush"
                    ? "crosshair"
                    : "crosshair",
            }}
          >
            {/* Prior ghosts */}
            {showPriorGhost &&
              priorFoci?.map((f) => (
                <circle
                  key={`g-${f.id}`}
                  cx={f.x}
                  cy={f.y}
                  r={f.radius_px}
                  fill="none"
                  stroke="rgba(99,102,241,0.7)"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  pointerEvents="none"
                />
              ))}

            {/* Operator foci (uses preview if scale-all is active) */}
            {previewFoci.map((f) => {
              const isSel = f.id === selectedId;
              const stroke = isSel
                ? "rgba(34,197,94,0.95)"
                : "rgba(220,38,38,0.95)";
              return (
                <g key={f.id}>
                  <circle
                    cx={f.x}
                    cy={f.y}
                    r={f.radius_px}
                    fill="rgba(220,38,38,0.32)"
                    stroke={stroke}
                    strokeWidth={isSel ? 4 : 3}
                  />
                  <circle cx={f.x} cy={f.y} r={3} fill={stroke} />
                </g>
              );
            })}

            {/* AI suggestions */}
            {aiSuggestions.map((s) => (
              <g
                key={`ai-${s.id}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  acceptAiSuggestion(s);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  dismissAiSuggestion(s);
                }}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={s.radius_px}
                  fill="rgba(249,115,22,0.18)"
                  stroke="rgba(249,115,22,0.95)"
                  strokeWidth={2.5}
                  strokeDasharray="4 3"
                />
                <text
                  x={s.x}
                  y={s.y + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="rgba(249,115,22,0.95)"
                  pointerEvents="none"
                >
                  AI
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className="text-xs text-stone-500">
          Mark tool: tap empty area to drop a focus, tap a focus to select,
          drag to move. Brush: hold &amp; drag to paint. Erase: tap a focus
          to delete. Click an AI suggestion to accept it; right-click to
          dismiss.
        </div>
      </div>

      {/* Side panel */}
      <aside className="space-y-3">
        {/* Stats */}
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Foci" value={String(editedCount)} />
            <Stat
              label="Disease coverage"
              value={`${(scaleAllBase ? previewPct : editedPct).toFixed(1)}%`}
            />
          </div>
          {priorMeta && (
            <div className="mt-2 flex justify-between text-[11px] text-stone-600">
              <span>vs last visit</span>
              <span
                className={
                  (fociDiff ?? 0) === 0 && (pctDiff ?? 0) === 0
                    ? "text-stone-500"
                    : "font-medium text-stone-900"
                }
              >
                {(fociDiff ?? 0) >= 0 ? "+" : ""}
                {fociDiff} foci · {(pctDiff ?? 0) >= 0 ? "+" : ""}
                {pctDiff?.toFixed(1)}%
              </span>
            </div>
          )}
        </div>

        {/* Tool selector */}
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Tool
          </h3>
          <div className="grid grid-cols-3 gap-1">
            <ToolButton
              label="Mark"
              hint="Add or move"
              active={tool === "mark"}
              onClick={() => setTool("mark")}
            />
            <ToolButton
              label="Brush"
              hint="Paint many"
              active={tool === "brush"}
              onClick={() => setTool("brush")}
            />
            <ToolButton
              label="Erase"
              hint="Tap to delete"
              active={tool === "erase"}
              onClick={() => setTool("erase")}
            />
          </div>
        </div>

        {/* Selected focus */}
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Selected focus
          </h3>
          {selectedFocus ? (
            <div className="space-y-2">
              <div className="text-xs text-stone-600">
                #{selectedFocus.id} at ({selectedFocus.x}, {selectedFocus.y})
              </div>
              <label className="block text-xs text-stone-600">
                Radius (mm)
                <input
                  type="range"
                  min={3}
                  max={MAX_FOCUS_RADIUS}
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
                  <span>{MAX_FOCUS_RADIUS}</span>
                </div>
              </label>
              <button
                onClick={removeSelected}
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                Remove (Del)
              </button>
            </div>
          ) : (
            <p className="text-xs text-stone-500">
              Tap a focus to adjust or remove it.
            </p>
          )}
        </div>

        {/* Bulk controls */}
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            All foci
          </h3>
          <div className="text-[11px] text-stone-600">
            {scaleAllBase ? (
              <>Preview: {scaleAll.toFixed(2)}× — apply or cancel below.</>
            ) : (
              <>
                Use this when every patch has grown or shrunk by roughly the
                same amount.
              </>
            )}
          </div>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={scaleAll}
            onChange={(e) => {
              startScaleAll();
              setScaleAll(Number(e.target.value));
            }}
            className="mt-2 w-full"
            disabled={foci.length === 0}
          />
          <div className="flex justify-between font-mono text-[11px] text-stone-500">
            <span>0.5×</span>
            <span>{scaleAll.toFixed(2)}×</span>
            <span>2×</span>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={applyScaleAll}
              disabled={!scaleAllBase || scaleAll === 1}
              className="rounded bg-stone-900 px-2 py-1 text-xs text-white disabled:opacity-30"
            >
              Apply
            </button>
            <button
              onClick={cancelScaleAll}
              disabled={!scaleAllBase}
              className="rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-30"
            >
              Cancel
            </button>
            <button
              onClick={clearAll}
              disabled={foci.length === 0}
              className="ml-auto rounded border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-30"
            >
              Clear all
            </button>
          </div>
        </div>

        {/* AI helper */}
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            AI helper (optional)
          </h3>
          <p className="text-[11px] text-stone-500">
            Ask Claude to suggest foci. Suggestions appear as orange dashed
            circles on the image — click one to accept it as your own,
            right-click to dismiss.
          </p>
          <label className="mt-2 block text-xs text-stone-600">
            Sensitivity
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={aiSensitivity}
              onChange={(e) => setAiSensitivity(Number(e.target.value))}
              className="mt-1 w-full"
              disabled={aiBusy}
            />
            <div className="flex justify-between font-mono text-[11px] text-stone-500">
              <span>1 strict</span>
              <span>{aiSensitivity}</span>
              <span>5 permissive</span>
            </div>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={getAiSuggestion}
              disabled={aiBusy}
              className="rounded bg-stone-900 px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              {aiBusy
                ? "Asking…"
                : aiSuggestions.length > 0
                  ? "Re-suggest"
                  : "Get AI suggestion"}
            </button>
            {aiSuggestions.length > 0 && (
              <>
                <button
                  onClick={acceptAllAi}
                  className="rounded border border-orange-300 px-2 py-1 text-xs text-orange-700 hover:bg-orange-50"
                >
                  Accept all ({aiSuggestions.length})
                </button>
                <button
                  onClick={dismissAllAi}
                  className="rounded border border-stone-300 px-2 py-1 text-xs"
                >
                  Dismiss
                </button>
              </>
            )}
          </div>
          {aiError && (
            <div className="mt-2 text-[11px] text-red-700">{aiError}</div>
          )}
          {aiSnapshot && (
            <div className="mt-2 text-[11px] text-stone-500">
              {aiSnapshot.modelId} ·{" "}
              <em className="font-normal text-stone-600">
                {aiSnapshot.result.reasoning?.slice(0, 140) ?? ""}
              </em>
            </div>
          )}
        </div>

        {/* Notes + save */}
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <label className="block text-xs font-medium text-stone-600">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={onBack}
              className="rounded border border-stone-300 px-3 py-1.5 text-sm"
            >
              ← Back
            </button>
            <button
              onClick={handleSave}
              className="ml-auto rounded bg-stone-900 px-3 py-1.5 text-sm text-white"
            >
              Save assessment
            </button>
          </div>
        </div>
      </aside>

      {/* Fixed magnifier — anchored to the viewport so it stays visible
          while the user scrolls. Hidden when the cursor isn't over the
          image. */}
      {hover && sourceImgReady && sourceImgRef.current && (
        <FociMagnifier
          img={sourceImgRef.current}
          point={hover}
          radius={MAGNIFIER_RADIUS}
          zoom={MAGNIFIER_ZOOM}
          foci={previewFoci}
          priorFoci={showPriorGhost ? (priorFoci ?? null) : null}
          aiSuggestions={aiSuggestions}
        />
      )}
    </div>
  );
}

function FociMagnifier({
  img,
  point,
  radius,
  zoom,
  foci,
  priorFoci,
  aiSuggestions,
}: {
  img: HTMLImageElement;
  point: { x: number; y: number };
  radius: number;
  zoom: number;
  foci: Focus[];
  priorFoci: Focus[] | null;
  aiSuggestions: Focus[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const rawCtx = c.getContext("2d");
    if (!rawCtx) return;
    const ctx: CanvasRenderingContext2D = rawCtx;
    const size = radius * 2;
    c.width = size;
    c.height = size;
    const sourceSize = size / zoom;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, size, size);

    // Draw the image patch under the cursor.
    ctx.drawImage(
      img,
      point.x - sourceSize / 2,
      point.y - sourceSize / 2,
      sourceSize,
      sourceSize,
      0,
      0,
      size,
      size
    );

    // Helper: draw a focus circle relative to the cursor at zoom level.
    function drawCircle(
      f: Focus,
      fill: string,
      stroke: string,
      lineWidth: number,
      dash?: number[]
    ) {
      const dx = (f.x - point.x) * zoom;
      const dy = (f.y - point.y) * zoom;
      const r = f.radius_px * zoom;
      const cx = size / 2 + dx;
      const cy = size / 2 + dy;
      // Skip if entirely outside the magnifier.
      if (cx + r < 0 || cy + r < 0 || cx - r > size || cy - r > size) return;
      ctx.beginPath();
      if (dash) ctx.setLineDash(dash);
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (fill !== "transparent") ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (priorFoci) {
      for (const f of priorFoci) {
        drawCircle(f, "transparent", "rgba(99,102,241,0.7)", 1.5, [6, 4]);
      }
    }
    for (const f of foci) {
      drawCircle(
        f,
        "rgba(220,38,38,0.32)",
        "rgba(220,38,38,0.95)",
        2.5
      );
    }
    for (const s of aiSuggestions) {
      drawCircle(
        s,
        "rgba(249,115,22,0.18)",
        "rgba(249,115,22,0.95)",
        2,
        [4, 3]
      );
    }

    // Crosshair
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
  }, [img, point, radius, zoom, foci, priorFoci, aiSuggestions]);

  return (
    <div
      className="pointer-events-none fixed right-4 top-24 z-50 flex flex-col items-center"
      style={{ width: radius * 2 }}
    >
      <canvas
        ref={ref}
        className="rounded-full border-4 border-white shadow-2xl ring-1 ring-stone-300"
        style={{ width: radius * 2, height: radius * 2 }}
      />
      <span className="mt-1 rounded-full bg-stone-900/80 px-2 py-0.5 text-[10px] font-semibold text-white">
        {zoom}× magnifier
      </span>
    </div>
  );
}

function ToolButton({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center rounded border-2 px-1.5 py-2 text-xs transition-colors ${
        active
          ? "border-stone-900 bg-stone-900 text-white"
          : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
      }`}
    >
      <span className="font-semibold">{label}</span>
      <span className="text-[10px] opacity-80">{hint}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-stone-50 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-stone-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
