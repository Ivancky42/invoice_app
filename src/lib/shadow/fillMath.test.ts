import { describe, expect, it } from "vitest";
import { planBuy, planSell, weightedAvgCost } from "@/lib/shadow/fillMath";

describe("planBuy", () => {
  it("fills the desired notional when cash covers it", () => {
    expect(planBuy(1000, 5000, 50)).toEqual({
      ok: true,
      notional: 1000,
      shares: 20,
      partial: false,
    });
  });

  it("fills partially rather than letting paper cash go negative", () => {
    const plan = planBuy(1000, 250, 50);
    expect(plan).toEqual({ ok: true, notional: 250, shares: 5, partial: true });
  });

  it("rejects when there is no cash at all", () => {
    expect(planBuy(1000, 0, 50)).toEqual({ ok: false, reason: "insufficient_cash" });
    expect(planBuy(1000, -20, 50)).toEqual({ ok: false, reason: "insufficient_cash" });
  });

  it("rejects a non-positive price instead of dividing by it", () => {
    expect(planBuy(1000, 5000, 0)).toEqual({ ok: false, reason: "insufficient_cash" });
  });
});

describe("weightedAvgCost", () => {
  it("averages the add into the existing cost basis", () => {
    expect(weightedAvgCost(10, 100, 10, 120)).toBe(110);
  });

  it("uses the fill price when there is no existing position", () => {
    expect(weightedAvgCost(0, 0, 5, 42.5)).toBe(42.5);
  });
});

describe("planSell", () => {
  it("trims half a position and books the realized P&L on the shares sold", () => {
    const plan = planSell(10, 100, 0.5, 120);
    expect(plan).toEqual({
      ok: true,
      sharesSold: 5,
      proceeds: 600,
      realizedPnl: 100,
      remainingShares: 5,
      closes: false,
    });
  });

  it("closes the position exactly on a full exit", () => {
    const plan = planSell(3.333333, 90, 1, 100);
    expect(plan.ok && plan.closes).toBe(true);
    expect(plan.ok && plan.remainingShares).toBe(0);
    expect(plan.ok && plan.sharesSold).toBe(3.333333);
  });

  it("sweeps sub-epsilon dust into the sale instead of stranding it", () => {
    const plan = planSell(10, 50, 0.9999999, 60);
    expect(plan.ok && plan.closes).toBe(true);
    expect(plan.ok && plan.sharesSold).toBe(10);
  });

  it("books a loss when the fill is below the average cost", () => {
    const plan = planSell(10, 100, 1, 80);
    expect(plan.ok && plan.realizedPnl).toBe(-200);
  });

  it("rejects when there is nothing open", () => {
    expect(planSell(0, 100, 1, 120)).toEqual({ ok: false, reason: "no_position" });
  });
});
