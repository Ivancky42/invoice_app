import { describe, expect, it } from "vitest";
import { applySlippage, SLIPPAGE_BPS, slippageFraction } from "./slippage";

describe("applySlippage", () => {
  it("makes buys more expensive and sells cheaper by SLIPPAGE_BPS", () => {
    expect(SLIPPAGE_BPS).toBe(10);
    expect(slippageFraction()).toBe(0.001);
    expect(applySlippage(100, "BUY")).toBeCloseTo(100.1, 10);
    expect(applySlippage(100, "SELL")).toBeCloseTo(99.9, 10);
  });

  it("is a no-op on non-positive prices", () => {
    expect(applySlippage(0, "BUY")).toBe(0);
    expect(applySlippage(-1, "SELL")).toBe(-1);
  });

  it("honours an explicit bps override", () => {
    expect(applySlippage(200, "BUY", 50)).toBeCloseTo(201, 10);
    expect(applySlippage(200, "SELL", 0)).toBe(200);
  });
});
