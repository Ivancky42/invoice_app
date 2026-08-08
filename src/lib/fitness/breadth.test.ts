import { describe, expect, it } from "vitest";
import {
  BREADTH_EXCLUDED_TICKERS,
  breadthFromReturns,
  excessMoveOf,
  MIN_BREADTH_SAMPLE,
  sessionBreadthFromByTicker,
  themeBreadthFor,
} from "@/lib/fitness/breadth";

describe("breadthFromReturns", () => {
  it("mixed signs: median and directional breadth over the whole sample", () => {
    const result = breadthFromReturns([-0.05, -0.01, 0.02, 0.03, 0.1]);
    expect(result.medianReturn).toBe(0.02);
    expect(result.breadthUp).toBe(0.6);
    expect(result.breadthDown).toBe(0.4);
  });

  it("all up: breadthUp is 1, breadthDown is 0", () => {
    const result = breadthFromReturns([0.01, 0.02, 0.03, 0.04]);
    expect(result.breadthUp).toBe(1);
    expect(result.breadthDown).toBe(0);
    expect(result.medianReturn).toBe(0.025);
  });

  it("empty input returns zeros rather than NaN", () => {
    expect(breadthFromReturns([])).toEqual({
      medianReturn: 0,
      breadthUp: 0,
      breadthDown: 0,
    });
  });

  it("flat returns count towards neither breadthUp nor breadthDown", () => {
    const result = breadthFromReturns([0, 0, 0.01, -0.01]);
    expect(result.breadthUp).toBe(0.25);
    expect(result.breadthDown).toBe(0.25);
  });
});

describe("sessionBreadthFromByTicker", () => {
  it("excludes index/ETF proxies (SPY/QQQ/CSPX) from sampleSize and byTicker", () => {
    const raw = new Map<string, number>();
    for (let i = 0; i < MIN_BREADTH_SAMPLE; i += 1) {
      raw.set(`T${i}`, 0.01 * (i + 1));
    }
    for (const proxy of BREADTH_EXCLUDED_TICKERS) {
      raw.set(proxy, 0.5); // outlier that would skew the median if counted
    }

    const result = sessionBreadthFromByTicker(raw);
    expect(result).not.toBeNull();
    expect(result!.sampleSize).toBe(MIN_BREADTH_SAMPLE);
    for (const proxy of BREADTH_EXCLUDED_TICKERS) {
      expect(result!.byTicker.has(proxy)).toBe(false);
    }
    // Median of T0..T9 (0.01..0.10) alone, unbiased by the 0.5 proxy returns.
    expect(result!.medianReturn).toBeCloseTo(0.055, 6);
  });

  it("returns null when the universe is thin only after excluding proxies", () => {
    const raw = new Map<string, number>();
    for (let i = 0; i < MIN_BREADTH_SAMPLE - 1; i += 1) {
      raw.set(`T${i}`, 0.01);
    }
    raw.set("SPY", 0.01); // would reach the floor only by counting the proxy
    expect(sessionBreadthFromByTicker(raw)).toBeNull();
  });
});

describe("excessMoveOf", () => {
  it("is the signed distance from the market median", () => {
    expect(excessMoveOf(0.1, 0.02)).toBe(0.08);
    expect(excessMoveOf(-0.05, 0.02)).toBe(-0.07);
    expect(excessMoveOf(0.02, 0.02)).toBe(0);
  });
});

describe("themeBreadthFor", () => {
  const byTicker = new Map<string, number>([
    ["AAA", 0.05],
    ["BBB", 0.03],
    ["CCC", 0.02],
    ["DDD", -0.01],
    ["EEE", 0.04],
    ["ZZZ", -0.02], // different theme
  ]);
  const themeOf = new Map<string, string>([
    ["AAA", "AI_INFRASTRUCTURE"],
    ["BBB", "AI_INFRASTRUCTURE"],
    ["CCC", "AI_INFRASTRUCTURE"],
    ["DDD", "AI_INFRASTRUCTURE"],
    ["EEE", "AI_INFRASTRUCTURE"],
    ["ZZZ", "NUCLEAR_POWER"],
  ]);

  it("fraction of same-theme tickers moving the same direction as the subject", () => {
    // AAA is up; other AI_INFRASTRUCTURE members: BBB up, CCC up, DDD down, EEE up → 3/4.
    expect(themeBreadthFor("AAA", byTicker, themeOf)).toBeCloseTo(0.75, 6);
  });

  it("returns null when fewer than 3 OTHER theme members have a return", () => {
    const thin = new Map<string, number>([
      ["AAA", 0.05],
      ["BBB", 0.03],
    ]);
    const thinTheme = new Map<string, string>([
      ["AAA", "AI_INFRASTRUCTURE"],
      ["BBB", "AI_INFRASTRUCTURE"],
    ]);
    expect(themeBreadthFor("AAA", thin, thinTheme)).toBeNull();
  });

  it("returns null for a ticker with no return or no theme", () => {
    expect(themeBreadthFor("MISSING", byTicker, themeOf)).toBeNull();
    const noTheme = new Map<string, string>();
    expect(themeBreadthFor("AAA", byTicker, noTheme)).toBeNull();
  });

  it("returns null when the subject itself is flat (no direction to match)", () => {
    const flatSubject = new Map(byTicker).set("AAA", 0);
    expect(themeBreadthFor("AAA", flatSubject, themeOf)).toBeNull();
  });
});
