"use client";

import { useEffect, useRef, useState } from "react";
import type { Focus } from "@/lib/anthropic";

export type OverlayMode = "off" | "foci" | "disease";

const DEFAULT_NEW_RADIUS = 18;

/**
 * Renders the rectified JPEG with an optional foci overlay.
 *
 * Read-only when `onFociChange` is undefined: a 3-way toggle picks between
 * Off / Foci / Disease. Editable when `onFociChange` is set: click empty
 * area to add a focus, drag to move, Delete key removes the selected one.
 * The radius slider lives in the parent (it needs the selected focus state).
 */
export function RectifiedCanvasView({
  jpegBase64,
  imageUrl,
  foci,
  fociCount,
  diseasePct,
  maxWidth = 500,
  onFociChange,
  selectedId,
  onSelectChange,
  initialMode = "foci",
}: {
  jpegBase64?: string;
  imageUrl?: string;
  foci?: Focus[];
  fociCount?: number;
  diseasePct?: number;
  maxWidth?: number;
  onFociChange?: (next: Focus[]) => void;
  selectedId?: number | null;
  onSelectChange?: (id: number | null) => void;
  initialMode?: OverlayMode;
}) {
  const src = jpegBase64
    ? `data:image/jpeg;base64,${jpegBase64}`
    : (imageUrl ?? "");
  const [mode, setMode] = useState<OverlayMode>(initialMode);
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [internalSelected, setInternalSelected] = useState<number | null>(null);

  const editable = !!onFociChange;
  const effectiveSelected =
    selectedId !== undefined ? selectedId : internalSelected;

  function setSelected(id: number | null) {
    setInternalSelected(id);
    onSelectChange?.(id);
  }

  const hasFoci = (foci?.length ?? 0) > 0;
  const hasDisease = typeof diseasePct === "number";

  function svgToCoords(e: React.MouseEvent | React.PointerEvent): {
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

  function handleSvgClick(e: React.MouseEvent) {
    if (!editable || !onFociChange || !foci) return;
    if (draggingId !== null) return; // a click that closes a drag — ignore
    const coords = svgToCoords(e);
    if (!coords) return;
    const newId = foci.length === 0 ? 1 : Math.max(...foci.map((f) => f.id)) + 1;
    const next: Focus = {
      id: newId,
      x: Math.round(coords.x),
      y: Math.round(coords.y),
      radius_px: DEFAULT_NEW_RADIUS,
    };
    onFociChange([...foci, next]);
    setSelected(newId);
  }

  function handleFocusPointerDown(e: React.PointerEvent, f: Focus) {
    if (!editable) return;
    e.stopPropagation();
    setSelected(f.id);
    setDraggingId(f.id);
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!editable || draggingId === null || !onFociChange || !foci) return;
    const coords = svgToCoords(e);
    if (!coords) return;
    onFociChange(
      foci.map((f) =>
        f.id === draggingId
          ? { ...f, x: Math.round(coords.x), y: Math.round(coords.y) }
          : f
      )
    );
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (draggingId === null) return;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    // Clear on next tick so the click handler that follows pointerup can
    // see we were dragging and skip the add-focus action.
    setTimeout(() => setDraggingId(null), 0);
  }

  // Keyboard delete while editing
  useEffect(() => {
    if (!editable) return;
    const change = onFociChange;
    const list = foci;
    if (!change || !list) return;
    function onKey(ev: KeyboardEvent) {
      if (effectiveSelected == null) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        change!(list!.filter((f) => f.id !== effectiveSelected));
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, foci, onFociChange, effectiveSelected]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {(hasFoci || hasDisease) && (
          <div className="inline-flex overflow-hidden rounded-md border border-stone-300 text-xs">
            <ModeButton
              label="No overlay"
              active={mode === "off"}
              onClick={() => setMode("off")}
            />
            <ModeButton
              label={`Foci${fociCount != null ? ` (${fociCount})` : ""}`}
              active={mode === "foci"}
              onClick={() => setMode("foci")}
              disabled={!hasFoci && !editable}
            />
            <ModeButton
              label={`Disease${
                diseasePct != null ? ` (${diseasePct.toFixed(1)}%)` : ""
              }`}
              active={mode === "disease"}
              onClick={() => setMode("disease")}
              disabled={!hasFoci && !editable}
            />
          </div>
        )}
        {editable && (
          <span className="text-xs text-stone-500">
            Click an empty area to add a focus. Drag to move. Press Delete to
            remove the selected focus.
          </span>
        )}
      </div>

      <div
        className="relative inline-block overflow-hidden rounded border border-stone-200"
        style={{ maxWidth }}
      >
        <img
          src={src}
          alt="Rectified quadrat"
          className="block w-full select-none"
          draggable={false}
          crossOrigin="anonymous"
        />
        {(mode !== "off" || editable) && foci && (
          <svg
            ref={svgRef}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            className={`absolute inset-0 h-full w-full ${
              editable ? "cursor-crosshair" : "pointer-events-none"
            }`}
            onClick={handleSvgClick}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {mode !== "off" &&
              foci.map((f) => (
                <FocusMark
                  key={f.id}
                  focus={f}
                  mode={mode}
                  selected={f.id === effectiveSelected}
                  onPointerDown={
                    editable ? (e) => handleFocusPointerDown(e, f) : undefined
                  }
                />
              ))}
          </svg>
        )}
      </div>
    </div>
  );
}

function FocusMark({
  focus,
  mode,
  selected,
  onPointerDown,
}: {
  focus: Focus;
  mode: OverlayMode;
  selected?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const interactive = !!onPointerDown;
  const ringStroke = selected
    ? "rgba(34, 197, 94, 0.95)"
    : "rgba(220, 38, 38, 0.95)";

  if (mode === "disease") {
    return (
      <g
        onPointerDown={onPointerDown}
        style={{ cursor: interactive ? "grab" : "default" }}
      >
        <circle
          cx={focus.x}
          cy={focus.y}
          r={focus.radius_px}
          fill="rgba(220, 38, 38, 0.4)"
          stroke={
            selected ? "rgba(34, 197, 94, 0.95)" : "rgba(220, 38, 38, 0.85)"
          }
          strokeWidth={selected ? 4 : 2}
        />
      </g>
    );
  }
  return (
    <g
      onPointerDown={onPointerDown}
      style={{ cursor: interactive ? "grab" : "default" }}
    >
      <circle
        cx={focus.x}
        cy={focus.y}
        r={focus.radius_px}
        fill="none"
        stroke={ringStroke}
        strokeWidth={selected ? 4 : 3}
      />
      <circle cx={focus.x} cy={focus.y} r={4} fill={ringStroke} />
      <text
        x={focus.x + focus.radius_px + 4}
        y={focus.y - focus.radius_px - 4}
        fontSize={20}
        fontWeight={700}
        fill="white"
        stroke="rgba(0,0,0,0.75)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {focus.id}
      </text>
    </g>
  );
}

function ModeButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 transition-colors ${
        active
          ? "bg-stone-900 text-white"
          : "bg-white text-stone-700 hover:bg-stone-50"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      {label}
    </button>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
