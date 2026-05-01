import { describe, expect, it } from "vitest";
import { bandFor, smithKerns, trailing5DayMean } from "../lib/smith-kerns";

describe("smithKerns", () => {
  it("matches the published formula at warm + humid conditions", () => {
    // T=20, RH=85: logit = -11.4041 + 0.1932*20 + 0.0894*85 = 0.0589
    // p = 1 / (1 + e^-0.0589) ≈ 0.5147
    const r = smithKerns(20, 85);
    expect(r.logit).toBeCloseTo(0.0589, 3);
    expect(r.probability).toBeCloseTo(0.5147, 3);
    expect(r.risk_band).toBe("High");
  });

  it("returns near-zero probability at cool + dry conditions", () => {
    // T=10, RH=60: logit = -11.4041 + 1.932 + 5.364 = -4.1081
    // p ≈ 0.01615
    const r = smithKerns(10, 60);
    expect(r.logit).toBeCloseTo(-4.1081, 3);
    expect(r.probability).toBeCloseTo(0.0161, 3);
    expect(r.risk_band).toBe("Low");
  });

  it("decomposes the logit into intercept + temperature + humidity terms", () => {
    const r = smithKerns(18, 80);
    expect(r.intercept).toBe(-11.4041);
    expect(r.temp_term).toBeCloseTo(0.1932 * 18, 6);
    expect(r.rh_term).toBeCloseTo(0.0894 * 80, 6);
    expect(r.logit).toBeCloseTo(r.intercept + r.temp_term + r.rh_term, 6);
  });

  it("flags moderate when probability sits between 0.20 and 0.30", () => {
    // Find a midrange case: T=16, RH=70
    // logit = -11.4041 + 3.0912 + 6.258 = -2.0549, p ≈ 0.1135 (low)
    // T=18, RH=75: logit = -11.4041 + 3.4776 + 6.705 = -1.2215, p ≈ 0.2278 (moderate)
    const r = smithKerns(18, 75);
    expect(r.probability).toBeGreaterThan(0.2);
    expect(r.probability).toBeLessThan(0.3);
    expect(r.risk_band).toBe("Moderate");
  });

  it("is monotonic in both inputs", () => {
    const a = smithKerns(15, 70).probability;
    const b = smithKerns(20, 70).probability;
    const c = smithKerns(20, 90).probability;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("bandFor", () => {
  it.each([
    [0, "Low"],
    [0.19, "Low"],
    [0.2, "Moderate"],
    [0.29, "Moderate"],
    [0.3, "High"],
    [1, "High"],
  ] as const)("p=%s -> %s", (p, expected) => {
    expect(bandFor(p)).toBe(expected);
  });
});

describe("trailing5DayMean", () => {
  it("returns null if fewer than 5 values", () => {
    expect(trailing5DayMean([1, 2, 3, 4])).toBeNull();
  });

  it("averages the last 5 values when more are present", () => {
    expect(trailing5DayMean([1, 2, 3, 4, 5])).toBe(3);
    expect(trailing5DayMean([99, 99, 99, 1, 2, 3, 4, 5])).toBe(3);
  });
});
