import type { RiskBand } from "./smith-kerns";

export type Palette = { bg: string; border: string; fg: string };

export function bandPalette(band: RiskBand): Palette {
  if (band === "High") {
    return { bg: "#fef2f2", border: "#fca5a5", fg: "#991b1b" };
  }
  if (band === "Moderate") {
    return { bg: "#fffbeb", border: "#fcd34d", fg: "#92400e" };
  }
  return { bg: "#f0fdf4", border: "#86efac", fg: "#166534" };
}

export function neutralPalette(): Palette {
  return { bg: "#f5f5f4", border: "#d6d3d1", fg: "#78716c" };
}
