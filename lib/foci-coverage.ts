// Computes the percentage of the rectified 1m² covered by a list of circular
// foci, correctly handling overlap. Implemented by rasterising the union of
// circles onto a small offscreen canvas and counting filled pixels — exact for
// the visualisation we render, no closed-form circle-union algebra required.

import type { Focus } from "./anthropic";

const COVERAGE_RES = 500; // 500x500 = 250k pixels, fast enough for live edits

export function diseasePercentFromFoci(foci: Focus[]): number {
  if (foci.length === 0) return 0;
  if (typeof document === "undefined") {
    // Server-side fallback: sum πr² (overcounts overlap).
    const totalPx = 1000 * 1000;
    const sum = foci.reduce((s, f) => s + Math.PI * f.radius_px ** 2, 0);
    return Math.min(100, (sum / totalPx) * 100);
  }

  const c = document.createElement("canvas");
  c.width = COVERAGE_RES;
  c.height = COVERAGE_RES;
  const ctx = c.getContext("2d");
  if (!ctx) return 0;
  const scale = COVERAGE_RES / 1000;

  ctx.fillStyle = "#000000";
  for (const f of foci) {
    ctx.beginPath();
    ctx.arc(f.x * scale, f.y * scale, f.radius_px * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  const data = ctx.getImageData(0, 0, COVERAGE_RES, COVERAGE_RES).data;
  let covered = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) covered++;
  }
  const total = COVERAGE_RES * COVERAGE_RES;
  return Math.min(100, (covered / total) * 100);
}
