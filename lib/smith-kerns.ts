// Smith-Kerns dollar spot logistic regression.
// Smith DL et al. (2018), "Development and evaluation of a weather-based
// dollar spot prediction model", PLOS ONE.
// doi:10.1371/journal.pone.0194216
//
//   logit(p) = -11.4041 + 0.1932 * T5 + 0.0894 * RH5
//   p        = exp(logit) / (1 + exp(logit))
//
// T5  = 5-day mean air temperature, °C
// RH5 = 5-day mean relative humidity, %

export const SMITH_KERNS = {
  intercept: -11.4041,
  tempCoef: 0.1932,
  rhCoef: 0.0894,
} as const;

export type RiskBand = "Low" | "Moderate" | "High";

export type SmithKernsResult = {
  t5_c: number;
  rh5_pct: number;
  intercept: number;
  temp_term: number;
  rh_term: number;
  logit: number;
  probability: number;
  risk_band: RiskBand;
};

export function smithKerns(t5_c: number, rh5_pct: number): SmithKernsResult {
  const temp_term = SMITH_KERNS.tempCoef * t5_c;
  const rh_term = SMITH_KERNS.rhCoef * rh5_pct;
  const logit = SMITH_KERNS.intercept + temp_term + rh_term;
  const probability = 1 / (1 + Math.exp(-logit));
  return {
    t5_c,
    rh5_pct,
    intercept: SMITH_KERNS.intercept,
    temp_term,
    rh_term,
    logit,
    probability,
    risk_band: bandFor(probability),
  };
}

export function bandFor(p: number): RiskBand {
  if (p < 0.2) return "Low";
  if (p < 0.3) return "Moderate";
  return "High";
}

// 5-day trailing mean. `series` must be ordered oldest -> newest.
// Returns null if fewer than 5 entries are available.
export function trailing5DayMean(series: number[]): number | null {
  if (series.length < 5) return null;
  const last5 = series.slice(-5);
  const sum = last5.reduce((acc, v) => acc + v, 0);
  return sum / 5;
}
