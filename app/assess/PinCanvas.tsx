"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CornerSet, Point } from "@/lib/homography";

type CornerKey = "tl" | "tr" | "br" | "bl";
const ORDER: CornerKey[] = ["tl", "tr", "br", "bl"];
const LABELS: Record<CornerKey, string> = {
  tl: "1 TL",
  tr: "2 TR",
  br: "3 BR",
  bl: "4 BL",
};
const COLOURS: Record<CornerKey, string> = {
  tl: "#ef4444",
  tr: "#3b82f6",
  br: "#10b981",
  bl: "#f59e0b",
};

const MAGNIFIER_RADIUS = 60;
const MAGNIFIER_ZOOM = 4;

export function PinCanvas({
  img,
  corners,
  onChange,
}: {
  img: HTMLImageElement;
  corners: Partial<CornerSet>;
  onChange: (c: Partial<CornerSet>) => void;
  meta?: unknown;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<Point | null>(null);
  const [dragging, setDragging] = useState<CornerKey | null>(null);

  const nextSlot: CornerKey | null = useMemo(() => {
    return ORDER.find((k) => !corners[k]) ?? null;
  }, [corners]);

  // On click, place the next pin (if any unfilled).
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (dragging) return;
    if (!nextSlot) return;
    const p = clientToImage(e.clientX, e.clientY);
    if (!p) return;
    onChange({ ...corners, [nextSlot]: p });
  }

  // Convert client (mouse) coords -> image-pixel coords.
  function clientToImage(clientX: number, clientY: number): Point | null {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * img.naturalWidth;
    const y = ((clientY - rect.top) / rect.height) * img.naturalHeight;
    if (x < 0 || y < 0 || x > img.naturalWidth || y > img.naturalHeight) return null;
    return { x, y };
  }

  function imageToClient(p: Point): { left: string; top: string } {
    return {
      left: `${(p.x / img.naturalWidth) * 100}%`,
      top: `${(p.y / img.naturalHeight) * 100}%`,
    };
  }

  // Drag handlers for an already-placed pin
  function handlePinPointerDown(k: CornerKey, e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    setDragging(k);
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function handlePinPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const p = clientToImage(e.clientX, e.clientY);
    if (p) onChange({ ...corners, [dragging]: p });
  }
  function handlePinPointerUp(e: React.PointerEvent) {
    setDragging(null);
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // Quadrilateral SVG outline once at least 2 pins are placed
  const placed = ORDER.filter((k) => corners[k]).map((k) => corners[k]!);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-sm">
        <label className="text-stone-700">Zoom</label>
        <input
          type="range"
          min={1}
          max={4}
          step={0.1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-40"
        />
        <span className="font-mono text-xs text-stone-500">{zoom.toFixed(1)}×</span>
        <span className="ml-auto text-xs text-stone-500">
          {nextSlot
            ? `Tap to place pin ${LABELS[nextSlot]}`
            : "All four pins placed. Drag any pin to fine-tune."}
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative max-h-[70vh] overflow-auto rounded border border-stone-200 bg-stone-900"
      >
        <div
          className="relative inline-block select-none"
          style={{ width: `${zoom * 100}%` }}
          onClick={onClick}
          onMouseMove={(e) => {
            const p = clientToImage(e.clientX, e.clientY);
            setHover(p);
            handlePinPointerMove(e as unknown as React.PointerEvent);
          }}
          onMouseLeave={() => setHover(null)}
          onPointerUp={handlePinPointerUp}
        >
          <img
            ref={imgRef}
            src={img.src}
            alt="Quadrat"
            className="block w-full select-none"
            draggable={false}
          />
          {/* Pins */}
          {ORDER.map((k) => {
            const p = corners[k];
            if (!p) return null;
            const pos = imageToClient(p);
            return (
              <div
                key={k}
                onPointerDown={(e) => handlePinPointerDown(k, e)}
                className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white shadow active:cursor-grabbing"
                style={{ left: pos.left, top: pos.top, background: COLOURS[k] }}
                title={LABELS[k]}
              >
                <span className="absolute left-full ml-1 whitespace-nowrap rounded bg-black/70 px-1 py-0.5 text-[10px] font-semibold text-white">
                  {LABELS[k]}
                </span>
              </div>
            );
          })}

          {/* Quadrilateral outline */}
          {placed.length >= 2 && (
            <svg
              className="pointer-events-none absolute inset-0"
              viewBox={`0 0 ${img.naturalWidth} ${img.naturalHeight}`}
              preserveAspectRatio="none"
            >
              <polygon
                points={ORDER.filter((k) => corners[k])
                  .map((k) => `${corners[k]!.x},${corners[k]!.y}`)
                  .join(" ")}
                fill="rgba(255,255,255,0.06)"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={Math.max(2, img.naturalWidth / 600)}
                strokeDasharray={`${img.naturalWidth / 100} ${img.naturalWidth / 200}`}
              />
            </svg>
          )}
        </div>

        {/* Magnifier — fixed corner overlay, shows pixels under the cursor */}
        {hover && (
          <Magnifier
            img={img}
            point={hover}
            radius={MAGNIFIER_RADIUS}
            zoom={MAGNIFIER_ZOOM}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {ORDER.map((k) => {
          const p = corners[k];
          return (
            <span
              key={k}
              className="rounded border px-2 py-0.5"
              style={{
                borderColor: p ? COLOURS[k] : "#d6d3d1",
                color: p ? COLOURS[k] : "#a8a29e",
              }}
            >
              {LABELS[k]}: {p ? `${p.x.toFixed(0)}, ${p.y.toFixed(0)}` : "—"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Magnifier({
  img,
  point,
  radius,
  zoom,
}: {
  img: HTMLImageElement;
  point: Point;
  radius: number;
  zoom: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const size = radius * 2;
    c.width = size;
    c.height = size;
    const sourceSize = size / zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
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
    // Crosshair
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
  }, [img, point, radius, zoom]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute right-3 top-3 rounded-full border-2 border-white shadow-lg"
      style={{ width: radius * 2, height: radius * 2 }}
    />
  );
}
