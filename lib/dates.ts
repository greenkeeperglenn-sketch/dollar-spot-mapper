// Small date helpers. All dates are ISO YYYY-MM-DD strings.

export const WEATHER_BACKFILL_START = "2026-03-01";

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

export function dateRange(startInclusive: string, endInclusive: string): string[] {
  const out: string[] = [];
  let d = startInclusive;
  while (d <= endInclusive) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}
