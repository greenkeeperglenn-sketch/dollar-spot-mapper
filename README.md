# Dollar Spot Monitor

STRI tool for tracking dollar spot disease pressure on golf greens. Two
parts:

1. **Environmental pressure** — daily Open-Meteo weather pull + Smith-Kerns
   logistic-regression model, surfaced on a dashboard with a temperature/
   humidity decomposition.
2. **Photo assessment** — drop a quadrat photo, pin its 4 corners, the app
   perspective-rectifies it to 1m × 1m and asks Claude Sonnet (vision) to
   count infection points.

Stack: Next.js 16 (App Router) + Tailwind 4 + TypeScript on Vercel,
Airtable for structured data, Vercel Blob for image + audit JSON storage.

---

## Setup

### 1. Environment

Copy `.env.example` to `.env.local` and fill in:

```
AIRTABLE_API_KEY=...           # Personal Access Token, scopes data.records:read+write on the base
AIRTABLE_BASE_ID=appXXXX...
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_ID=claude-sonnet-4-6   # optional override; pin to a dated snapshot when ready
BLOB_READ_WRITE_TOKEN=...      # auto-injected by Vercel; needed for local dev only
CRON_SECRET=...                # any random string; used to authorise /api/cron/daily-weather
```

### 2. Airtable schema

Create one Airtable base with **four** tables. Field names are case-sensitive
and must match exactly.

#### `Locations`

| Field | Type |
| --- | --- |
| `name` | Single line text |
| `latitude` | Number (decimal) |
| `longitude` | Number (decimal) |
| `notes` | Long text |
| `active` | Checkbox |
| `sites` | Long text — optional, one site name per line (e.g. `Chipping green`, `11th tee`); these populate the Site dropdown when assessing a photo |
| `logo_url` | URL — optional, public URL of the location's logo. Set automatically when you paste/drop a logo on the Locations page (uploaded to Vercel Blob); also displayed on the dashboard and in copy-share images |

#### `WeatherReadings`

| Field | Type |
| --- | --- |
| `location` | Link → Locations |
| `date` | Date (YYYY-MM-DD) |
| `temp_mean_c` | Number |
| `rh_mean_pct` | Number |
| `source` | Single line text |

#### `PressureScores`

| Field | Type |
| --- | --- |
| `location` | Link → Locations |
| `date` | Date |
| `temp_5day_avg_c` | Number |
| `rh_5day_avg_pct` | Number |
| `temp_term` | Number (= 0.1932 × T5) |
| `rh_term` | Number (= 0.0894 × RH5) |
| `smith_kerns_probability` | Number |
| `risk_band` | Single select with options `Low`, `Moderate`, `High` |

#### `PhotoAssessments`

| Field | Type |
| --- | --- |
| `location` | Link → Locations |
| `photo_date` | Date |
| `quadrat_label` | Single line text (default `Q1`) |
| `rectified_image_url` | URL |
| `audit_json_url` | URL |
| `foci_count` | Number |
| `disease_pct` | Number |
| `sensitivity` | Number |
| `notes` | Long text |

### 3. Run locally

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # vitest unit tests for the Smith-Kerns model
pnpm build        # production build + type check
```

### 4. Deploy

Push to a Vercel project; set the same env vars in the project settings.
The cron in `vercel.json` runs `/api/cron/daily-weather` at 06:00 UTC daily.
To trigger it manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://your-app.vercel.app/api/cron/daily-weather
```

---

## Architecture

```
app/
  page.tsx                          dashboard
  locations/                        CRUD + per-location history
  assess/                           photo workflow
  api/
    locations[/:id]                 CRUD
    weather/backfill                manual fetch
    cron/daily-weather              authenticated cron entry point
    pressure                        dashboard data feed
    analyse                         Claude vision (server-side)
    assessments                     Vercel Blob + PhotoAssessments write
lib/
  smith-kerns.ts                    pure logistic-regression function
  airtable.ts                       typed REST wrapper
  open-meteo.ts                     historical weather fetcher
  weather-pipeline.ts               compose: fetch → upsert → score
  homography.ts                     WebGL perspective warp
  anthropic.ts                      vision client + prompt builder + hashing
  dates.ts                          ISO date helpers
prompts/
  foci-count-v1.md                  versioned + hashed into every audit JSON
tests/
  smith-kerns.test.ts               13 cases — published values + monotonicity
```

### Smith-Kerns

`logit(p) = -11.4041 + 0.1932 · T5 + 0.0894 · RH5`. T5 in °C, RH5 in %.
Source: Smith DL et al. 2018, PLOS ONE. Risk bands: Low (<0.20),
Moderate (0.20–0.30), High (≥0.30).

### Backfill

When a location is created the app kicks off a backfill from
`WEATHER_BACKFILL_START` (currently `2026-03-01`) to yesterday — one
Open-Meteo request, one Airtable row per day, then a `PressureScores`
row for every date with a full trailing 5-day window. Idempotent.

### Audit JSON

Every photo assessment writes a JSON document to Vercel Blob containing the
original filename, EXIF date (or `null`), corner pixel coordinates,
homography coefficients, model id, prompt version + sha256 hash, sensitivity
setting, and parsed result. The blob URL is referenced from the Airtable
row. This lets you re-derive the exact rectified image and re-run the same
prompt in the future.

### Photo workflow steps

`/assess` is a single client-side state machine:

1. **Upload** — drag-drop. HEIC is converted client-side via `heic-to`.
2. **Date + location** — EXIF `DateTimeOriginal` is auto-detected if
   present; for WhatsApp images (which strip EXIF) the user picks via
   quick buttons (Today / Yesterday / This Mon) or a date picker.
3. **Pin corners** — tap the inside corner of each white spray-painted
   L-mark in TL → TR → BR → BL order. Zoom slider + magnifier for
   precision; pins are draggable after placement.
4. **Rectify** — WebGL fragment shader applies the inverse homography to
   produce a 1000 × 1000 px square (1 px = 1 mm).
5. **Analyse** — Claude Sonnet returns a foci count + disease %. A
   sensitivity slider (1 strict → 5 permissive) tunes the prompt.
6. **Save** — rectified JPEG and audit JSON go to Vercel Blob, and a
   `PhotoAssessments` row is written.

For multiple photos at the same location on the same date, just save each
with a different `quadrat_label` (e.g. `Q1`, `Q2`). The location history
view averages across quadrats and shows individual values too.
