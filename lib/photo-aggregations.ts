import type { PhotoAssessment } from "./airtable";

export type PhotoDayGroup = {
  date: string;
  list: PhotoAssessment[];
  meanFoci: number;
  meanPct: number;
};

// Groups photos by `photo_date` and computes per-date means across quadrats.
// Result is sorted oldest -> newest.
export function groupPhotosByDate(photos: PhotoAssessment[]): PhotoDayGroup[] {
  const map = new Map<string, PhotoAssessment[]>();
  for (const p of photos) {
    const list = map.get(p.photo_date) ?? [];
    list.push(p);
    map.set(p.photo_date, list);
  }
  return Array.from(map.entries())
    .map(([date, list]) => ({
      date,
      list,
      meanFoci: list.reduce((s, p) => s + p.foci_count, 0) / list.length,
      meanPct: list.reduce((s, p) => s + p.disease_pct, 0) / list.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
