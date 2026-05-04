// Thin typed REST wrapper for Airtable. No third-party SDK.
//
// Required env:
//   AIRTABLE_API_KEY   - Personal Access Token with data.records:read+write
//                        on the base.
//   AIRTABLE_BASE_ID   - appXXXXXXXXXXXXXX

import { bandFor, type RiskBand } from "./smith-kerns";

const API = "https://api.airtable.com/v0";

// Table names match the Airtable schema in README.md.
export const TABLES = {
  locations: "Locations",
  weather: "WeatherReadings",
  pressure: "PressureScores",
  photos: "PhotoAssessments",
} as const;

// ---------- Domain types ---------------------------------------------------

export type Location = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  notes?: string;
  active: boolean;
  /** Site names (e.g. "Chipping green", "11th tee") for this location's
   *  Assess-photo dropdown. Stored newline-separated in the `sites` field. */
  sites: string[];
  /** Public URL of the location's branding logo (Vercel Blob). */
  logo_url?: string;
};

export type WeatherReading = {
  id: string;
  locationId: string;
  date: string; // YYYY-MM-DD
  temp_mean_c: number;
  rh_mean_pct: number;
  source: string;
};

export type PressureScore = {
  id: string;
  locationId: string;
  date: string;
  temp_5day_avg_c: number;
  rh_5day_avg_pct: number;
  temp_term: number;
  rh_term: number;
  smith_kerns_probability: number;
  risk_band: RiskBand;
};

export type PhotoAssessment = {
  id: string;
  locationId: string;
  photo_date: string;
  quadrat_label: string;
  rectified_image_url: string;
  audit_json_url: string;
  foci_count: number;
  disease_pct: number;
  sensitivity: number;
  notes?: string;
};

// ---------- Internals ------------------------------------------------------

type AirtableRecord<F> = { id: string; createdTime?: string; fields: F };
type AirtableList<F> = { records: AirtableRecord<F>[]; offset?: string };

function env() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    throw new Error("AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set");
  }
  return { apiKey, baseId };
}

async function request<T>(
  path: string,
  init: RequestInit & { searchParams?: Record<string, string | string[]> } = {}
): Promise<T> {
  const { apiKey, baseId } = env();
  const url = new URL(`${API}/${baseId}/${path}`);
  if (init.searchParams) {
    for (const [k, v] of Object.entries(init.searchParams)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    // Airtable's JSON errors look like {"error":{"type":"...","message":"..."}}.
    // Extract the message so the surfaced error is human-readable.
    let pretty = body;
    try {
      const j = JSON.parse(body) as {
        error?: string | { type?: string; message?: string };
      };
      if (typeof j.error === "string") pretty = j.error;
      else if (j.error?.message) {
        pretty = j.error.type
          ? `${j.error.type}: ${j.error.message}`
          : j.error.message;
      }
    } catch {
      // body wasn't JSON; keep raw
    }
    throw new Error(`Airtable ${res.status} on ${path}: ${pretty}`);
  }
  return res.json() as Promise<T>;
}

async function listAll<F>(
  table: string,
  searchParams: Record<string, string | string[]> = {}
): Promise<AirtableRecord<F>[]> {
  const out: AirtableRecord<F>[] = [];
  let offset: string | undefined;
  do {
    const params: Record<string, string | string[]> = {
      pageSize: "100",
      ...searchParams,
    };
    if (offset) params.offset = offset;
    const page = await request<AirtableList<F>>(encodeURIComponent(table), {
      method: "GET",
      searchParams: params,
    });
    out.push(...page.records);
    offset = page.offset;
  } while (offset);
  return out;
}

// ---------- Locations ------------------------------------------------------

type LocationFields = {
  name: string;
  latitude: number;
  longitude: number;
  notes?: string;
  active?: boolean;
  /** Newline-separated list of site names. Optional. */
  sites?: string;
  /** Public URL of the location's logo (set by the server after upload). */
  logo_url?: string;
};

function parseSites(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function rowToLocation(r: AirtableRecord<LocationFields>): Location {
  return {
    id: r.id,
    name: r.fields.name ?? "",
    latitude: r.fields.latitude ?? 0,
    longitude: r.fields.longitude ?? 0,
    notes: r.fields.notes,
    active: r.fields.active ?? false,
    sites: parseSites(r.fields.sites),
    logo_url: r.fields.logo_url || undefined,
  };
}

export async function listLocations(): Promise<Location[]> {
  const rows = await listAll<LocationFields>(TABLES.locations);
  return rows.map(rowToLocation);
}

export async function listActiveLocations(): Promise<Location[]> {
  const rows = await listAll<LocationFields>(TABLES.locations, {
    filterByFormula: "{active}",
  });
  return rows.map(rowToLocation);
}

export async function getLocation(id: string): Promise<Location | null> {
  try {
    const r = await request<AirtableRecord<LocationFields>>(
      `${encodeURIComponent(TABLES.locations)}/${id}`
    );
    return rowToLocation(r);
  } catch (e) {
    if (e instanceof Error && /404/.test(e.message)) return null;
    throw e;
  }
}

export async function createLocation(input: {
  name: string;
  latitude: number;
  longitude: number;
  notes?: string;
  active?: boolean;
  sites?: string[];
}): Promise<Location> {
  const r = await request<AirtableRecord<LocationFields>>(
    encodeURIComponent(TABLES.locations),
    {
      method: "POST",
      body: JSON.stringify({
        fields: {
          name: input.name,
          latitude: input.latitude,
          longitude: input.longitude,
          notes: input.notes,
          active: input.active ?? true,
          sites: input.sites?.join("\n"),
        },
      }),
    }
  );
  return rowToLocation(r);
}

export async function updateLocation(
  id: string,
  patch: Partial<{
    name: string;
    latitude: number;
    longitude: number;
    notes: string;
    active: boolean;
    sites: string[];
    logo_url: string | null;
  }>
): Promise<Location> {
  const fields: LocationFields = {} as LocationFields;
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.latitude !== undefined) fields.latitude = patch.latitude;
  if (patch.longitude !== undefined) fields.longitude = patch.longitude;
  if (patch.notes !== undefined) fields.notes = patch.notes;
  if (patch.active !== undefined) fields.active = patch.active;
  if (patch.sites !== undefined) fields.sites = patch.sites.join("\n");
  if (patch.logo_url !== undefined) fields.logo_url = patch.logo_url ?? "";
  const r = await request<AirtableRecord<LocationFields>>(
    `${encodeURIComponent(TABLES.locations)}/${id}`,
    { method: "PATCH", body: JSON.stringify({ fields }) }
  );
  return rowToLocation(r);
}

export async function deleteLocation(id: string): Promise<void> {
  await request(`${encodeURIComponent(TABLES.locations)}/${id}`, {
    method: "DELETE",
  });
}

// ---------- WeatherReadings ------------------------------------------------

type WeatherFields = {
  location?: string[];
  date?: string;
  temp_mean_c?: number;
  rh_mean_pct?: number;
  source?: string;
};

function rowToWeather(r: AirtableRecord<WeatherFields>): WeatherReading {
  return {
    id: r.id,
    locationId: r.fields.location?.[0] ?? "",
    date: r.fields.date ?? "",
    temp_mean_c: r.fields.temp_mean_c ?? 0,
    rh_mean_pct: r.fields.rh_mean_pct ?? 0,
    source: r.fields.source ?? "",
  };
}

export async function listWeatherForLocation(
  locationId: string,
  opts?: { sinceDate?: string; untilDate?: string }
): Promise<WeatherReading[]> {
  // Airtable's filterByFormula on linked-record tables is awkward; the
  // cheapest reliable approach is to fetch by date range and filter client-side
  // by the linked location.
  const since = opts?.sinceDate;
  const until = opts?.untilDate;
  const dateClauses: string[] = [];
  if (since) dateClauses.push(`IS_AFTER({date}, DATEADD('${since}', -1, 'day'))`);
  if (until) dateClauses.push(`IS_BEFORE({date}, DATEADD('${until}', 1, 'day'))`);
  const formula = dateClauses.length
    ? `AND(${dateClauses.join(",")})`
    : undefined;

  const rows = await listAll<WeatherFields>(TABLES.weather, {
    ...(formula ? { filterByFormula: formula } : {}),
    "sort[0][field]": "date",
    "sort[0][direction]": "asc",
  });
  return rows
    .map(rowToWeather)
    .filter((w) => w.locationId === locationId);
}

export async function findWeatherByLocationDate(
  locationId: string,
  date: string
): Promise<WeatherReading | null> {
  const rows = await listAll<WeatherFields>(TABLES.weather, {
    filterByFormula: `{date}='${date}'`,
  });
  const match = rows.map(rowToWeather).find((w) => w.locationId === locationId);
  return match ?? null;
}

export async function upsertWeatherReading(input: {
  locationId: string;
  date: string;
  temp_mean_c: number;
  rh_mean_pct: number;
  source: string;
}): Promise<WeatherReading> {
  const existing = await findWeatherByLocationDate(input.locationId, input.date);
  const fields: WeatherFields = {
    location: [input.locationId],
    date: input.date,
    temp_mean_c: input.temp_mean_c,
    rh_mean_pct: input.rh_mean_pct,
    source: input.source,
  };
  if (existing) {
    const r = await request<AirtableRecord<WeatherFields>>(
      `${encodeURIComponent(TABLES.weather)}/${existing.id}`,
      { method: "PATCH", body: JSON.stringify({ fields }) }
    );
    return rowToWeather(r);
  }
  const r = await request<AirtableRecord<WeatherFields>>(
    encodeURIComponent(TABLES.weather),
    { method: "POST", body: JSON.stringify({ fields }) }
  );
  return rowToWeather(r);
}

// ---------- PressureScores -------------------------------------------------

type PressureFields = {
  location?: string[];
  date?: string;
  temp_5day_avg_c?: number;
  rh_5day_avg_pct?: number;
  temp_term?: number;
  rh_term?: number;
  smith_kerns_probability?: number;
  risk_band?: RiskBand;
};

function rowToPressure(r: AirtableRecord<PressureFields>): PressureScore {
  const p = r.fields.smith_kerns_probability ?? 0;
  return {
    id: r.id,
    locationId: r.fields.location?.[0] ?? "",
    date: r.fields.date ?? "",
    temp_5day_avg_c: r.fields.temp_5day_avg_c ?? 0,
    rh_5day_avg_pct: r.fields.rh_5day_avg_pct ?? 0,
    temp_term: r.fields.temp_term ?? 0,
    rh_term: r.fields.rh_term ?? 0,
    smith_kerns_probability: p,
    risk_band: r.fields.risk_band ?? bandFor(p),
  };
}

export async function listPressureForLocation(
  locationId: string,
  opts?: { sinceDate?: string }
): Promise<PressureScore[]> {
  const since = opts?.sinceDate;
  const formula = since
    ? `IS_AFTER({date}, DATEADD('${since}', -1, 'day'))`
    : undefined;
  const rows = await listAll<PressureFields>(TABLES.pressure, {
    ...(formula ? { filterByFormula: formula } : {}),
    "sort[0][field]": "date",
    "sort[0][direction]": "asc",
  });
  return rows
    .map(rowToPressure)
    .filter((s) => s.locationId === locationId);
}

export async function findPressureByLocationDate(
  locationId: string,
  date: string
): Promise<PressureScore | null> {
  const rows = await listAll<PressureFields>(TABLES.pressure, {
    filterByFormula: `{date}='${date}'`,
  });
  const match = rows.map(rowToPressure).find((s) => s.locationId === locationId);
  return match ?? null;
}

export async function upsertPressureScore(input: {
  locationId: string;
  date: string;
  temp_5day_avg_c: number;
  rh_5day_avg_pct: number;
  temp_term: number;
  rh_term: number;
  smith_kerns_probability: number;
  risk_band: RiskBand;
}): Promise<PressureScore> {
  const existing = await findPressureByLocationDate(input.locationId, input.date);
  const fields: PressureFields = {
    location: [input.locationId],
    date: input.date,
    temp_5day_avg_c: input.temp_5day_avg_c,
    rh_5day_avg_pct: input.rh_5day_avg_pct,
    temp_term: input.temp_term,
    rh_term: input.rh_term,
    smith_kerns_probability: input.smith_kerns_probability,
    risk_band: input.risk_band,
  };
  if (existing) {
    const r = await request<AirtableRecord<PressureFields>>(
      `${encodeURIComponent(TABLES.pressure)}/${existing.id}`,
      { method: "PATCH", body: JSON.stringify({ fields }) }
    );
    return rowToPressure(r);
  }
  const r = await request<AirtableRecord<PressureFields>>(
    encodeURIComponent(TABLES.pressure),
    { method: "POST", body: JSON.stringify({ fields }) }
  );
  return rowToPressure(r);
}

// ---------- PhotoAssessments -----------------------------------------------

type PhotoFields = {
  location?: string[];
  photo_date?: string;
  quadrat_label?: string;
  rectified_image_url?: string;
  audit_json_url?: string;
  foci_count?: number;
  disease_pct?: number;
  sensitivity?: number;
  notes?: string;
};

function rowToPhoto(r: AirtableRecord<PhotoFields>): PhotoAssessment {
  return {
    id: r.id,
    locationId: r.fields.location?.[0] ?? "",
    photo_date: r.fields.photo_date ?? "",
    quadrat_label: r.fields.quadrat_label ?? "Q1",
    rectified_image_url: r.fields.rectified_image_url ?? "",
    audit_json_url: r.fields.audit_json_url ?? "",
    foci_count: r.fields.foci_count ?? 0,
    disease_pct: r.fields.disease_pct ?? 0,
    sensitivity: r.fields.sensitivity ?? 3,
    notes: r.fields.notes,
  };
}

export async function listPhotosForLocation(
  locationId: string
): Promise<PhotoAssessment[]> {
  const rows = await listAll<PhotoFields>(TABLES.photos, {
    "sort[0][field]": "photo_date",
    "sort[0][direction]": "asc",
  });
  return rows.map(rowToPhoto).filter((p) => p.locationId === locationId);
}

export async function listAllPhotos(): Promise<PhotoAssessment[]> {
  const rows = await listAll<PhotoFields>(TABLES.photos, {
    "sort[0][field]": "photo_date",
    "sort[0][direction]": "asc",
  });
  return rows.map(rowToPhoto);
}

export async function createPhotoAssessment(input: {
  locationId: string;
  photo_date: string;
  quadrat_label: string;
  rectified_image_url: string;
  audit_json_url: string;
  foci_count: number;
  disease_pct: number;
  sensitivity: number;
  notes?: string;
}): Promise<PhotoAssessment> {
  const r = await request<AirtableRecord<PhotoFields>>(
    encodeURIComponent(TABLES.photos),
    {
      method: "POST",
      body: JSON.stringify({
        fields: {
          location: [input.locationId],
          photo_date: input.photo_date,
          quadrat_label: input.quadrat_label,
          rectified_image_url: input.rectified_image_url,
          audit_json_url: input.audit_json_url,
          foci_count: input.foci_count,
          disease_pct: input.disease_pct,
          sensitivity: input.sensitivity,
          notes: input.notes,
        },
      }),
    }
  );
  return rowToPhoto(r);
}

export async function getPhotoAssessment(
  id: string
): Promise<PhotoAssessment | null> {
  try {
    const r = await request<AirtableRecord<PhotoFields>>(
      `${encodeURIComponent(TABLES.photos)}/${id}`
    );
    return rowToPhoto(r);
  } catch (e) {
    if (e instanceof Error && /\b404\b/.test(e.message)) return null;
    throw e;
  }
}

export async function updatePhotoAssessment(
  id: string,
  patch: Partial<{
    locationId: string;
    quadrat_label: string;
    notes: string;
  }>
): Promise<PhotoAssessment> {
  const fields: PhotoFields = {};
  if (patch.locationId !== undefined) fields.location = [patch.locationId];
  if (patch.quadrat_label !== undefined)
    fields.quadrat_label = patch.quadrat_label;
  if (patch.notes !== undefined) fields.notes = patch.notes;
  const r = await request<AirtableRecord<PhotoFields>>(
    `${encodeURIComponent(TABLES.photos)}/${id}`,
    { method: "PATCH", body: JSON.stringify({ fields }) }
  );
  return rowToPhoto(r);
}

export async function deletePhotoAssessment(id: string): Promise<void> {
  await request(`${encodeURIComponent(TABLES.photos)}/${id}`, {
    method: "DELETE",
  });
}
