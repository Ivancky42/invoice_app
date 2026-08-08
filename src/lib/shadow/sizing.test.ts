import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "@/lib/stocks/config";
import {
  buySizeFraction,
  sellSizeFraction,
  targetFractionForConviction,
} from "@/lib/shadow/sizing";
import { classifyDecisionType } from "@/lib/shadow/orders";

const limits = DEFAULT_LIMITS;

describe("targetFractionForConviction", () => {
  it("maps conviction onto the tier bands' top of range", () => {
    expect(targetFractionForConviction(1, limits)).toBe(limits.tierBands.TEST_STARTER[1]);
    expect(targetFractionForConviction(2, limits)).toBe(limits.tierBands.TEST_STARTER[1]);
    expect(targetFractionForConviction(3, limits)).toBe(limits.tierBands.CONFIRMATION[1]);
    expect(targetFractionForConviction(4, limits)).toBe(limits.tierBands.CONVICTION[1]);
    expect(targetFractionForConviction(5, limits)).toBe(limits.tierBands.CONVICTION[1]);
  });

  it("treats an unknown conviction as the smallest tier, never the largest", () => {
    expect(targetFractionForConviction(null, limits)).toBe(limits.tierBands.TEST_STARTER[1]);
    expect(targetFractionForConviction(undefined, limits)).toBe(
      limits.tierBands.TEST_STARTER[1],
    );
  });

  it("reads the bands off the passed ruleset, not a global default", () => {
    const candidate = {
      ...limits,
      tierBands: { ...limits.tierBands, CONVICTION: [0, 0.2] as [number, number] },
    };
    expect(targetFractionForConviction(5, candidate)).toBe(0.2);
  });
});

describe("buySizeFraction", () => {
  it("sizes a flat ticker at the conviction band", () => {
    expect(buySizeFraction(5, 0, limits)).toEqual({
      ok: true,
      sizeFraction: limits.tierBands.CONVICTION[1],
      capped: false,
    });
  });

  it("clamps an add to the headroom under singlePositionPct", () => {
    // 12% already open, 15% cap → only 3% may be added even at full conviction.
    const result = buySizeFraction(5, 0.12, limits);
    expect(result).toEqual({ ok: true, sizeFraction: 0.03, capped: true });
  });

  it("rejects a ticker already at the cap", () => {
    expect(buySizeFraction(5, limits.singlePositionPct, limits)).toEqual({
      ok: false,
      reason: "position_cap",
    });
  });

  it("rejects a ticker above the cap rather than sizing zero or negative", () => {
    expect(buySizeFraction(3, 0.4, limits)).toEqual({ ok: false, reason: "position_cap" });
  });

  it("rounds to the sizeFraction column's 6dp scale", () => {
    const bands = {
      ...limits,
      tierBands: { ...limits.tierBands, TEST_STARTER: [0, 0.0123456789] as [number, number] },
    };
    const result = buySizeFraction(1, 0, bands);
    expect(result).toEqual({ ok: true, sizeFraction: 0.012346, capped: false });
  });
});

describe("sellSizeFraction", () => {
  it("passes a trim and a full exit through unchanged", () => {
    expect(sellSizeFraction(0.5)).toBe(0.5);
    expect(sellSizeFraction(1)).toBe(1);
  });

  it("never exceeds the whole position or goes negative", () => {
    expect(sellSizeFraction(2)).toBe(1);
    expect(sellSizeFraction(-1)).toBe(0);
  });
});

describe("classifyDecisionType", () => {
  it("maps exposure-increasing decisions to BUY", () => {
    for (const t of ["BUY", "ADD", "AVERAGE_DOWN"] as const) {
      expect(classifyDecisionType(t)).toEqual({ kind: "buy" });
    }
  });

  it("maps REDUCE to a half sell and EXIT to a full sell", () => {
    expect(classifyDecisionType("REDUCE")).toEqual({ kind: "sell", portion: 0.5 });
    expect(classifyDecisionType("EXIT")).toEqual({ kind: "sell", portion: 1 });
  });

  it("treats counterfactual decisions (and null) as no order at all", () => {
    for (const t of ["HOLD", "WAIT", "AVOID", "DO_NOT_AVERAGE_DOWN"] as const) {
      expect(classifyDecisionType(t)).toEqual({ kind: "none" });
    }
    expect(classifyDecisionType(null)).toEqual({ kind: "none" });
  });
});
