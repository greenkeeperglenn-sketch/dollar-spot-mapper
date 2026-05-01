"use client";

import { useState } from "react";
import type { Focus } from "@/lib/anthropic";

export type OverlayMode = "off" | "foci" | "disease";

export function RectifiedCanvasView({
  jpegBase64,
  foci,
  diseasePct,
  fociCount,
  maxWidth = 500,
}: {
  jpegBase64: string;
  foci?: Focus[];
  diseasePct?: number;
  fociCount?: number;
  maxWidth?: number;
}) {
  const [mode, setMode] = useState<OverlayMode>("foci");
  const hasFoci = (foci?.length ?? 0) > 0;
  const hasDisease = typeof diseasePct === "number";

  return (
    <div className="space-y-2">
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
            disabled={!hasFoci}
          />
          <ModeButton
            label={`Disease${
              diseasePct != null ? ` (${diseasePct.toFixed(1)}%)` : ""
            }`}
            active={mode === "disease"}
            onClick={() => setMode("disease")}
            disabled={!hasFoci}
          />
        </div>
      )}

      <div
        className="relative inline-block overflow-hidden rounded border border-stone-200"
        style={{ maxWidth }}
      >
        <img
          src={`data:image/jpeg;base64,${jpegBase64}`}
          alt="Rectified quadrat"
          className="block w-full"
        />
        {mode !== "off" && hasFoci && foci && (
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {foci.map((f) => (
              <FocusMark key={f.id} focus={f} mode={mode} />
            ))}
          </svg>
        )}
      </div>

      {mode === "foci" && hasFoci && (
        <p className="text-xs text-stone-500">
          Each red ring is one focus identified by the model. The number is
          the focus id from the model's reply.
        </p>
      )}
      {mode === "disease" && hasFoci && (
        <p className="text-xs text-stone-500">
          Filled red areas are the diseased patches the model used to compute
          its disease coverage estimate.
        </p>
      )}
    </div>
  );
}

function FocusMark({ focus, mode }: { focus: Focus; mode: OverlayMode }) {
  if (mode === "disease") {
    return (
      <circle
        cx={focus.x}
        cy={focus.y}
        r={focus.radius_px}
        fill="rgba(220, 38, 38, 0.4)"
        stroke="rgba(220, 38, 38, 0.85)"
        strokeWidth={2}
      />
    );
  }
  // "foci" mode: outlined circle + numbered label
  return (
    <g>
      <circle
        cx={focus.x}
        cy={focus.y}
        r={focus.radius_px}
        fill="none"
        stroke="rgba(220, 38, 38, 0.95)"
        strokeWidth={3}
      />
      <circle
        cx={focus.x}
        cy={focus.y}
        r={3}
        fill="rgba(220, 38, 38, 0.95)"
      />
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
