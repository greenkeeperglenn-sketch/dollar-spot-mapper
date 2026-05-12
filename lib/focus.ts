export type Focus = {
  id: number;
  x: number;
  y: number;
  radius_px: number;
  confidence?: "low" | "medium" | "high";
};
