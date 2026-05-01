// Open-Meteo Historical Weather API — free, no API key.
// Docs: https://open-meteo.com/en/docs/historical-weather-api

export type DailyWeather = {
  date: string; // YYYY-MM-DD
  temp_mean_c: number;
  rh_mean_pct: number;
};

type ArchiveResponse = {
  daily?: {
    time?: string[];
    temperature_2m_mean?: (number | null)[];
    relative_humidity_2m_mean?: (number | null)[];
  };
};

export async function fetchDailyRange(input: {
  latitude: number;
  longitude: number;
  startDate: string; // inclusive
  endDate: string; // inclusive
}): Promise<DailyWeather[]> {
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(input.latitude));
  url.searchParams.set("longitude", String(input.longitude));
  url.searchParams.set("start_date", input.startDate);
  url.searchParams.set("end_date", input.endDate);
  url.searchParams.set(
    "daily",
    "temperature_2m_mean,relative_humidity_2m_mean"
  );
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Open-Meteo ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as ArchiveResponse;
  const times = json.daily?.time ?? [];
  const temps = json.daily?.temperature_2m_mean ?? [];
  const rhs = json.daily?.relative_humidity_2m_mean ?? [];

  const out: DailyWeather[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = temps[i];
    const r = rhs[i];
    if (t == null || r == null) continue;
    out.push({ date: times[i], temp_mean_c: t, rh_mean_pct: r });
  }
  return out;
}
