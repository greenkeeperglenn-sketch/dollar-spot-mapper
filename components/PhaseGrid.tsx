"use client";

import type { PressureScore } from "@/lib/airtable";
import type { ForecastPressureRow } from "@/lib/forecast-pressure";
import { smithKerns } from "@/lib/smith-kerns";

const T_MIN = 5;
const T_MAX = 35;
const T_STEP = 1;
const T_CELLS = (T_MAX - T_MIN) / T_STEP;

const RH_MIN = 40;
const RH_MAX = 100;
const RH_STEP = 5;
const RH_CELLS = (RH_MAX - RH_MIN) / RH_STEP;

const W = 720;
const H = 400;
const PAD_L = 56;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 44;
const INNER_W = W - PAD_L - PAD_R;
const INNER_H = H - PAD_T - PAD_B;
const CELL_W = INNER_W / T_CELLS;
const CELL_H = INNER_H / RH_CELLS;

function tToX(t: number): number {
  const clamped = Math.max(T_MIN, Math.min(T_MAX, t));
  return PAD_L + ((clamped - T_MIN) / (T_MAX - T_MIN)) * INNER_W;
}
function rhToY(rh: number): number {
  const clamped = Math.max(RH_MIN, Math.min(RH_MAX, rh));
  return PAD_T + ((RH_MAX - clamped) / (RH_MAX - RH_MIN)) * INNER_H;
}

function bandFill(p: number): string {
  if (p < 0.2) return "#dcfce7"; // green-100
  if (p < 0.3) return "#fef3c7"; // amber-100
  return "#fecaca"; // red-200
}

export function PhaseGrid({
  scores,
  forecast,
}: {
  scores: PressureScore[];
  forecast: ForecastPressureRow[];
}) {
  const last7 = scores.slice(-7);
  const next7 = forecast.slice(0, 7);
  const today = last7[last7.length - 1];

  // Pre-compute cell colours + probabilities once at the cell centre.
  const cells: Array<{
    x: number;
    y: number;
    t: number;
    rh: number;
    p: number;
    fill: string;
  }> = [];
  for (let ri = 0; ri < RH_CELLS; ri++) {
    const rhCenter = RH_MAX - (ri + 0.5) * RH_STEP;
    for (let ti = 0; ti < T_CELLS; ti++) {
      const tCenter = T_MIN + (ti + 0.5) * T_STEP;
      const r = smithKerns(tCenter, rhCenter);
      cells.push({
        x: PAD_L + ti * CELL_W,
        y: PAD_T + ri * CELL_H,
        t: tCenter,
        rh: rhCenter,
        p: r.probability,
        fill: bandFill(r.probability),
      });
    }
  }

  // Trail paths
  const actualPath = last7
    .map((s, i) => {
      const x = tToX(s.temp_5day_avg_c);
      const y = rhToY(s.rh_5day_avg_pct);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  // Bridge: prepend today's actual to the forecast trail so the dashed
  // line starts where the solid line ended.
  const forecastChain: Array<{ t: number; rh: number; date: string }> = [];
  if (today) {
    forecastChain.push({
      t: today.temp_5day_avg_c,
      rh: today.rh_5day_avg_pct,
      date: today.date,
    });
  }
  for (const f of next7) {
    forecastChain.push({
      t: f.temp_5day_avg_c,
      rh: f.rh_5day_avg_pct,
      date: f.date,
    });
  }
  const forecastPath = forecastChain
    .map(
      (p, i) => `${i === 0 ? "M" : "L"} ${tToX(p.t)} ${rhToY(p.rh)}`
    )
    .join(" ");

  // X axis ticks: every 5°C
  const tTicks: number[] = [];
  for (let t = T_MIN; t <= T_MAX; t += 5) tTicks.push(t);

  // Y axis ticks: every 10%
  const rhTicks: number[] = [];
  for (let rh = RH_MIN; rh <= RH_MAX; rh += 10) rhTicks.push(rh);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight text-stone-900">
          Pressure phase plot
        </h2>
        <p className="text-xs text-stone-500 leading-relaxed">
          Smith-Kerns probability for every (5-day mean temperature, 5-day
          mean humidity) combination — same green / amber / red bands as the
          main chart. The trail shows where the location has been (solid,
          last 7 days) and where it&apos;s heading (dashed, next 7 days
          forecast). The big dot is today.
        </p>
      </header>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ minWidth: 560, height: "auto" }}
        >
          {/* Grid cells */}
          {cells.map((c, i) => (
            <rect
              key={i}
              x={c.x}
              y={c.y}
              width={CELL_W + 0.5}
              height={CELL_H + 0.5}
              fill={c.fill}
              stroke="rgba(255,255,255,0.6)"
              strokeWidth={0.5}
            >
              <title>
                T={c.t.toFixed(0)}°C, RH={c.rh.toFixed(0)}%, p=
                {(c.p * 100).toFixed(1)}%
              </title>
            </rect>
          ))}

          {/* % text in each cell */}
          {cells.map((c, i) => (
            <text
              key={`txt-${i}`}
              x={c.x + CELL_W / 2}
              y={c.y + CELL_H / 2 + 3}
              textAnchor="middle"
              fontSize={9}
              fill="#1c1917"
              fillOpacity={0.55}
              fontWeight={500}
              pointerEvents="none"
            >
              {Math.round(c.p * 100)}
            </text>
          ))}

          {/* Axis frame */}
          <rect
            x={PAD_L}
            y={PAD_T}
            width={INNER_W}
            height={INNER_H}
            fill="none"
            stroke="#1c1917"
            strokeWidth={1}
            strokeOpacity={0.3}
          />

          {/* Y axis ticks (RH) */}
          {rhTicks.map((rh) => (
            <g key={`rh-${rh}`}>
              <line
                x1={PAD_L - 4}
                x2={PAD_L}
                y1={rhToY(rh)}
                y2={rhToY(rh)}
                stroke="#1c1917"
                strokeOpacity={0.4}
                strokeWidth={1}
              />
              <text
                x={PAD_L - 8}
                y={rhToY(rh) + 4}
                textAnchor="end"
                fontSize={11}
                fill="#57534e"
              >
                {rh}%
              </text>
            </g>
          ))}
          <text
            x={14}
            y={PAD_T + INNER_H / 2}
            transform={`rotate(-90, 14, ${PAD_T + INNER_H / 2})`}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill="#1c1917"
          >
            5-day mean humidity (%)
          </text>

          {/* X axis ticks (T) */}
          {tTicks.map((t) => (
            <g key={`t-${t}`}>
              <line
                x1={tToX(t)}
                x2={tToX(t)}
                y1={PAD_T + INNER_H}
                y2={PAD_T + INNER_H + 4}
                stroke="#1c1917"
                strokeOpacity={0.4}
                strokeWidth={1}
              />
              <text
                x={tToX(t)}
                y={PAD_T + INNER_H + 16}
                textAnchor="middle"
                fontSize={11}
                fill="#57534e"
              >
                {t}°C
              </text>
            </g>
          ))}
          <text
            x={PAD_L + INNER_W / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill="#1c1917"
          >
            5-day mean temperature (°C)
          </text>

          {/* Forecast trail (dashed) — drawn first so the actual line
              and today dot sit on top */}
          {forecastPath && (
            <path
              d={forecastPath}
              fill="none"
              stroke="#9ca3af"
              strokeWidth={2.5}
              strokeDasharray="6 4"
              strokeLinecap="round"
            />
          )}
          {next7.map((f, i) => (
            <circle
              key={`fc-${i}`}
              cx={tToX(f.temp_5day_avg_c)}
              cy={rhToY(f.rh_5day_avg_pct)}
              r={3}
              fill="#9ca3af"
              stroke="#ffffff"
              strokeWidth={1.5}
            >
              <title>
                {f.date}: {f.temp_5day_avg_c.toFixed(1)}°C,{" "}
                {f.rh_5day_avg_pct.toFixed(0)}% — p=
                {(f.smith_kerns_probability * 100).toFixed(0)}%
              </title>
            </circle>
          ))}

          {/* Actual trail (solid) */}
          {actualPath && (
            <path
              d={actualPath}
              fill="none"
              stroke="#1c1917"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          )}
          {last7.map((s, i) => (
            <circle
              key={`ac-${i}`}
              cx={tToX(s.temp_5day_avg_c)}
              cy={rhToY(s.rh_5day_avg_pct)}
              r={3}
              fill="#1c1917"
              stroke="#ffffff"
              strokeWidth={1.5}
            >
              <title>
                {s.date}: {s.temp_5day_avg_c.toFixed(1)}°C,{" "}
                {s.rh_5day_avg_pct.toFixed(0)}% — p=
                {(s.smith_kerns_probability * 100).toFixed(0)}%
              </title>
            </circle>
          ))}

          {/* Today emphasised */}
          {today && (
            <g>
              <circle
                cx={tToX(today.temp_5day_avg_c)}
                cy={rhToY(today.rh_5day_avg_pct)}
                r={9}
                fill="#1c1917"
                stroke="#ffffff"
                strokeWidth={3}
              />
              <text
                x={tToX(today.temp_5day_avg_c) + 14}
                y={rhToY(today.rh_5day_avg_pct) - 8}
                fontSize={11}
                fontWeight={700}
                fill="#1c1917"
                pointerEvents="none"
              >
                Today
              </text>
            </g>
          )}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-stone-600">
        <LegendSwatch fill="#dcfce7" label="Low (<20%)" />
        <LegendSwatch fill="#fef3c7" label="Moderate (20–30%)" />
        <LegendSwatch fill="#fecaca" label="High (≥30%)" />
        <span className="ml-2 inline-flex items-center gap-1">
          <span
            className="inline-block h-0 w-6 border-t-[2.5px] border-stone-900"
            style={{ borderStyle: "solid" }}
          />
          Last 7 days
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-0 w-6 border-t-[2.5px]"
            style={{ borderStyle: "dashed", borderColor: "#9ca3af" }}
          />
          Next 7 days
        </span>
      </div>
    </section>
  );
}

function LegendSwatch({ fill, label }: { fill: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-3 w-4 border border-stone-300"
        style={{ background: fill }}
      />
      {label}
    </span>
  );
}
