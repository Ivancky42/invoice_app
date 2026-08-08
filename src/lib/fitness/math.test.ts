import { describe, expect, it } from "vitest";
import {
  classifyMove,
  counterfactualCredit,
  drawdownPenalty,
  evaluateCandidate,
  fitness,
  driftGuard,
  maxDrawdown,
  permittedSize,
  sequentialZ,
  turnoverCost,
  windowReturn,
} from "@/lib/fitness/math";
import { DEFAULT_LIMITS } from "@/lib/stocks/config";

const limits = DEFAULT_LIMITS;

describe("counterfactualCredit", () => {
  it("credits a refusal of a name that then fell (the MU/MP/IONQ/LUNR/ASTS shape)", () => {
    const result = counterfactualCredit({
      priceAtDecision: 100,
      priceAtHorizon: 60,
      permittedSize: 0.03,
    });
    expect(result.horizonReturn).toBe(-0.4);
    expect(result.credit).toBe(0.012);
  });

  it("DEBITS a refusal of a name that then rose — this is what stops blanket caution", () => {
    const result = counterfactualCredit({
      priceAtDecision: 100,
      priceAtHorizon: 125,
      permittedSize: 0.03,
    });
    expect(result.horizonReturn).toBe(0.25);
    expect(result.credit).toBeLessThan(0);
    expect(result.credit).toBe(-0.0075);
  });

  it("scores a flat name at zero", () => {
    expect(
      counterfactualCredit({
        priceAtDecision: 100,
        priceAtHorizon: 100,
        permittedSize: 0.03,
      }),
    ).toEqual({ horizonReturn: 0, credit: 0 });
  });

  it("rejects a non-positive price rather than emitting a nonsense credit", () => {
    expect(() =>
      counterfactualCredit({ priceAtDecision: 0, priceAtHorizon: 10, permittedSize: 0.03 }),
    ).toThrow();
    expect(() =>
      counterfactualCredit({ priceAtDecision: 10, priceAtHorizon: 0, permittedSize: 0.03 }),
    ).toThrow();
  });
});

describe("permittedSize", () => {
  it("maps conviction onto the tier bands", () => {
    const at = (conviction: number | null) =>
      permittedSize({ limits, decisionType: "AVOID", conviction });
    expect(at(1)).toBe(limits.tierBands.TEST_STARTER[1]);
    expect(at(2)).toBe(limits.tierBands.TEST_STARTER[1]);
    expect(at(3)).toBe(limits.tierBands.CONFIRMATION[1]);
    expect(at(4)).toBe(limits.tierBands.CONVICTION[1]);
    expect(at(5)).toBe(limits.tierBands.CONVICTION[1]);
    expect(at(null)).toBe(limits.tierBands.TEST_STARTER[1]);
  });

  it("clamps to singlePositionPct", () => {
    const tight = { ...limits, singlePositionPct: 0.05 };
    expect(permittedSize({ limits: tight, decisionType: "AVOID", conviction: 5 })).toBe(0.05);
  });

  it("clamps a non-DNAD decision to the single-position HEADROOM, not the absolute cap", () => {
    // Held 0.10 under a 0.15 cap: the refusal only declined the 0.05 top-up.
    expect(
      permittedSize({ limits, decisionType: "AVOID", conviction: 5, currentWeight: 0.1 }),
    ).toBe(0.05);
    // Already at the cap — nothing was refused.
    expect(
      permittedSize({ limits, decisionType: "AVOID", conviction: 5, currentWeight: 0.15 }),
    ).toBe(0);
    expect(
      permittedSize({ limits, decisionType: "AVOID", conviction: 5, currentWeight: 0.2 }),
    ).toBe(0);
  });

  it("applies the headroom clamp on top of the DNAD incremental band", () => {
    // spp 0.05, CONFIRMATION top 0.06, held 0.04 → min(0.06 − 0.04, 0.05 − 0.04) = 0.01.
    const tight = { ...limits, singlePositionPct: 0.05 };
    expect(tight.tierBands.CONFIRMATION[1]).toBe(0.06);
    expect(
      permittedSize({
        limits: tight,
        decisionType: "DO_NOT_AVERAGE_DOWN",
        currentWeight: 0.04,
      }),
    ).toBe(0.01);
  });

  it("clamps a SPECULATIVE name to the sleeve headroom", () => {
    const size = permittedSize({
      limits: { ...limits, speculativeSleevePct: 0.15 },
      decisionType: "AVOID",
      conviction: 5,
      sleeve: "SPECULATIVE",
      speculativeSleeveWeight: 0.14,
    });
    expect(size).toBeLessThanOrEqual(0.01);
    expect(size).toBe(0.01);
  });

  it("never goes negative when the speculative sleeve is already over its cap", () => {
    expect(
      permittedSize({
        limits,
        decisionType: "AVOID",
        conviction: 5,
        sleeve: "SPECULATIVE",
        speculativeSleeveWeight: 0.2,
      }),
    ).toBe(0);
  });

  it("sizes DO_NOT_AVERAGE_DOWN as the INCREMENTAL add, not a fresh position", () => {
    expect(limits.tierBands.CONFIRMATION[1]).toBe(0.06);
    expect(
      permittedSize({ limits, decisionType: "DO_NOT_AVERAGE_DOWN", currentWeight: 0.04 }),
    ).toBe(0.02);
    expect(
      permittedSize({ limits, decisionType: "DO_NOT_AVERAGE_DOWN", currentWeight: 0.08 }),
    ).toBe(0);
  });

  it("returns 0 for DO_NOT_AVERAGE_DOWN when there is no open weight (no phantom add)", () => {
    // BULL-shaped: DNAD with held=0 used to return the full confirmation band (0.06).
    expect(
      permittedSize({ limits, decisionType: "DO_NOT_AVERAGE_DOWN", currentWeight: 0 }),
    ).toBe(0);
    expect(permittedSize({ limits, decisionType: "DO_NOT_AVERAGE_DOWN" })).toBe(0);
  });

  it("zeros size when already at/over the single-name cap even if the tier band is large", () => {
    expect(
      permittedSize({
        limits,
        decisionType: "AVOID",
        conviction: 5,
        currentWeight: 0.15,
      }),
    ).toBe(0);
    expect(
      permittedSize({
        limits,
        decisionType: "AVOID",
        conviction: 5,
        currentWeight: 0.2,
      }),
    ).toBe(0);
  });

  it("zeros a SPECULATIVE add when the sleeve is already at/over its cap", () => {
    expect(
      permittedSize({
        limits,
        decisionType: "AVOID",
        conviction: 2,
        sleeve: "SPECULATIVE",
        currentWeight: 0.02,
        speculativeSleeveWeight: limits.speculativeSleevePct,
      }),
    ).toBe(0);
  });
});

describe("windowReturn / maxDrawdown", () => {
  it("returns the window's total return", () => {
    expect(windowReturn([100, 110, 121])).toBe(0.21);
    expect(windowReturn([100])).toBe(0);
  });

  it("measures peak-to-trough drawdown", () => {
    expect(maxDrawdown([100, 110, 88, 95])).toBe(0.2);
    expect(maxDrawdown([100, 110, 120])).toBe(0);
  });
});

describe("drawdownPenalty", () => {
  it("is zero inside the free band", () => {
    expect(drawdownPenalty({ maxDrawdown: 0.08 })).toBe(0);
    expect(drawdownPenalty({ maxDrawdown: 0.1 })).toBe(0);
  });

  it("charges half the excess beyond the free band", () => {
    expect(drawdownPenalty({ maxDrawdown: 0.2 })).toBe(0.05);
    expect(drawdownPenalty({ maxDrawdown: 0.2, freeBand: 0.05, weight: 1 })).toBe(0.15);
  });
});

describe("turnoverCost", () => {
  it("charges the rate on gross notional as a fraction of NAV", () => {
    expect(turnoverCost([10_000, 10_000], 100_000)).toBe(0.0002);
  });

  it("counts sells (negative notionals) too and never goes negative", () => {
    expect(turnoverCost([10_000, -10_000], 100_000)).toBe(0.0002);
    expect(turnoverCost([10_000], 0)).toBe(0);
  });
});

describe("fitness", () => {
  it("sums all five terms with the right signs", () => {
    expect(
      fitness({
        shadowReturn: 0.03,
        avoidedCredit: 0.012,
        drawdownPenalty: 0.02,
        turnoverCost: 0.0002,
        benchmarkReturn: 0.01,
      }),
    ).toBe(0.0118);
  });

  it("scores a branch that lagged the benchmark negative (benchmark isolation)", () => {
    expect(
      fitness({
        shadowReturn: 0.03,
        avoidedCredit: 0,
        drawdownPenalty: 0,
        turnoverCost: 0,
        benchmarkReturn: 0.05,
      }),
    ).toBe(-0.02);
  });
});

describe("sequentialZ", () => {
  it("returns a null z below two observations", () => {
    expect(sequentialZ([]).z).toBeNull();
    expect(sequentialZ([0.01]).z).toBeNull();
  });

  it("returns a null z when the standard error is degenerate", () => {
    const result = sequentialZ([0.01, 0.01, 0.01]);
    expect(result.se).toBe(0);
    expect(result.z).toBeNull();
  });

  it("uses per-session increments: sd/sqrt(n), not overlapping rolling levels", () => {
    const result = sequentialZ([0.02, 0.04, 0.06]);
    expect(result.n).toBe(3);
    expect(result.delta).toBeCloseTo(0.04, 12);
    expect(result.se).toBeCloseTo(0.02 / Math.sqrt(3), 12);
    // z = mean / (sd/sqrt(n)) = 0.04 / (0.02/sqrt(3)) = 2*sqrt(3)
    expect(result.z).toBeCloseTo(2 * Math.sqrt(3), 12);
  });
});

describe("evaluateCandidate", () => {
  const base = {
    sessions: 10,
    decisions: 10,
    lane: "FAST" as const,
    candidateMaxDrawdown: 0.1,
    liveMaxDrawdown: 0.1,
    branchMaxDrawdown: 0.1,
    promotionsIn90d: 0,
  };

  it("promotes a FAST candidate at the lane minimums", () => {
    expect(evaluateCandidate({ ...base, z: 2.0 })).toBe("PROMOTE");
  });

  it("keeps a SLOW candidate running on the same evidence", () => {
    expect(evaluateCandidate({ ...base, lane: "SLOW", z: 2.0 })).toBe("CONTINUE");
  });

  it("early-kills a clearly worse candidate once it has ten sessions", () => {
    expect(evaluateCandidate({ ...base, z: -1.5 })).toBe("EARLY_KILL");
    expect(evaluateCandidate({ ...base, sessions: 9, z: -1.5 })).toBe("CONTINUE");
  });

  it("calls it inconclusive after sixty sessions without a verdict", () => {
    expect(evaluateCandidate({ ...base, sessions: 60, decisions: 5, z: 0.4 })).toBe(
      "INCONCLUSIVE",
    );
  });

  it("hard-reverts on the kernel drawdown floor even with a glowing z", () => {
    expect(
      evaluateCandidate({ ...base, z: 3, branchMaxDrawdown: 0.26 }),
    ).toBe("HARD_REVERT");
  });

  it("blocks promotion when the candidate took materially more drawdown than live", () => {
    expect(
      evaluateCandidate({ ...base, z: 3, candidateMaxDrawdown: 0.13, liveMaxDrawdown: 0.1 }),
    ).toBe("CONTINUE");
  });

  it("still promotes a tiny-drawdown candidate when LIVE has never drawn down", () => {
    // Relative gate alone would be `<= 0` here and block every promotion in a rising tape.
    expect(
      evaluateCandidate({
        ...base,
        z: 3,
        liveMaxDrawdown: 0,
        candidateMaxDrawdown: 0.001,
      }),
    ).toBe("PROMOTE");
  });

  it("still blocks a candidate past the absolute drawdown floor against a scratchless live", () => {
    expect(
      evaluateCandidate({
        ...base,
        z: 3,
        liveMaxDrawdown: 0,
        candidateMaxDrawdown: 0.06,
      }),
    ).toBe("CONTINUE");
  });

  it("blocks promotion at the 90-day rate limit", () => {
    expect(evaluateCandidate({ ...base, z: 3, promotionsIn90d: 8 })).toBe("CONTINUE");
    expect(evaluateCandidate({ ...base, z: 3, promotionsIn90d: 7 })).toBe("PROMOTE");
  });

  it("can only ever CONTINUE (or HARD_REVERT) on a null z", () => {
    expect(evaluateCandidate({ ...base, z: null, sessions: 30 })).toBe("CONTINUE");
    expect(evaluateCandidate({ ...base, z: null, branchMaxDrawdown: 0.4 })).toBe(
      "HARD_REVERT",
    );
  });
});

describe("classifyMove", () => {
  const base = {
    breadth: 0.2,
    themeBreadth: 0.2,
    excessMove: 0.01,
    hasTier12Evidence: false,
    sampleSize: 40,
    breadthMarketThreshold: limits.breadthMarketThreshold,
    themeBreadthThreshold: limits.themeBreadthThreshold,
    excessMoveIdiosyncratic: limits.excessMoveIdiosyncratic,
  };

  it("refuses to attribute anything on a thin sample", () => {
    expect(classifyMove({ ...base, sampleSize: 5, breadth: 0.9 })).toBe("INSUFFICIENT_DATA");
  });

  it("calls a broad tape a market move (the GLXY shape)", () => {
    expect(classifyMove({ ...base, breadth: 0.6 })).toBe("MARKET_MOVE");
  });

  it("calls a theme move when breadth is narrow but the theme is moving", () => {
    expect(classifyMove({ ...base, breadth: 0.2, themeBreadth: 0.7 })).toBe("THEME_MOVE");
  });

  it("calls a large excess move idiosyncratic", () => {
    expect(classifyMove({ ...base, excessMove: -0.18 })).toBe("IDIOSYNCRATIC");
  });

  it("calls a tier-1/2-evidenced move idiosyncratic without an excess move", () => {
    expect(classifyMove({ ...base, hasTier12Evidence: true })).toBe("IDIOSYNCRATIC");
  });
});

describe("driftGuard", () => {
  const base = {
    paramPath: "limits.singlePositionPct",
    hardRange: [0.05, 0.2] as [number, number],
    proposed: 0.15,
    valueAt90dAgo: 0.15,
    valueAtV1: 0.15,
    consecutiveLoosenings: 0,
    looseningDirection: "UP" as const,
  };

  it("allows a parameter that sits inside every rail", () => {
    expect(driftGuard({ ...base, proposed: 0.16 })).toEqual({ allowed: true });
  });

  it("refuses a value outside the hard range FIRST", () => {
    // Also breaches both drift rails — the hard range must be the code reported.
    expect(driftGuard({ ...base, proposed: 0.5 })).toEqual({
      allowed: false,
      code: "HARD_RANGE",
    });
  });

  it("refuses more than 30% drift from the 90-day-ago value", () => {
    expect(driftGuard({ ...base, proposed: 0.2, valueAt90dAgo: 0.1 })).toEqual({
      allowed: false,
      code: "DRIFT_90D",
    });
  });

  it("refuses more than 60% drift from the v1 value", () => {
    expect(
      driftGuard({ ...base, proposed: 0.18, valueAt90dAgo: 0.175, valueAtV1: 0.1 }),
    ).toEqual({ allowed: false, code: "DRIFT_V1" });
  });

  it("skips a RELATIVE rail whose baseline is zero (0 would freeze the parameter forever)", () => {
    expect(
      driftGuard({
        ...base,
        hardRange: [0, 0.2],
        proposed: 0.02,
        valueAt90dAgo: 0,
        valueAtV1: 0,
      }),
    ).toEqual({ allowed: true });
    // The hard range is still a wall on a zero baseline.
    expect(
      driftGuard({
        ...base,
        hardRange: [0, 0.2],
        proposed: 0.3,
        valueAt90dAgo: 0,
        valueAtV1: 0,
      }),
    ).toEqual({ allowed: false, code: "HARD_RANGE" });
  });

  it("refuses a fourth consecutive loosening in the loosening direction", () => {
    expect(
      driftGuard({ ...base, proposed: 0.16, consecutiveLoosenings: 3 }),
    ).toEqual({ allowed: false, code: "CONSECUTIVE_LOOSENING" });
    // Same history, but the proposal TIGHTENS — allowed.
    expect(
      driftGuard({ ...base, proposed: 0.14, consecutiveLoosenings: 3 }),
    ).toEqual({ allowed: true });
  });

  it("reads the loosening direction per parameter (DOWN loosens a floor)", () => {
    expect(
      driftGuard({
        ...base,
        paramPath: "limits.cashFloorPct",
        proposed: 0.14,
        consecutiveLoosenings: 3,
        looseningDirection: "DOWN",
      }),
    ).toEqual({ allowed: false, code: "CONSECUTIVE_LOOSENING" });
  });
});
