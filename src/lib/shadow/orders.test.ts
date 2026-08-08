import { describe, expect, it } from "vitest";
import { classifyDecisionType, sellDisposition } from "@/lib/shadow/orders";

describe("classifyDecisionType", () => {
  it("maps exposure-changing decisions to buy/sell intents", () => {
    expect(classifyDecisionType("BUY")).toEqual({ kind: "buy" });
    expect(classifyDecisionType("ADD")).toEqual({ kind: "buy" });
    expect(classifyDecisionType("AVERAGE_DOWN")).toEqual({ kind: "buy" });
    expect(classifyDecisionType("REDUCE")).toEqual({ kind: "sell", portion: 0.5 });
    expect(classifyDecisionType("EXIT")).toEqual({ kind: "sell", portion: 1 });
  });

  it("never fabricates an order for a counterfactual decision", () => {
    expect(classifyDecisionType("HOLD")).toEqual({ kind: "none" });
    expect(classifyDecisionType("WAIT")).toEqual({ kind: "none" });
    expect(classifyDecisionType("AVOID")).toEqual({ kind: "none" });
    expect(classifyDecisionType("DO_NOT_AVERAGE_DOWN")).toEqual({ kind: "none" });
    expect(classifyDecisionType(null)).toEqual({ kind: "none" });
    expect(classifyDecisionType(undefined)).toEqual({ kind: "none" });
  });
});

describe("sellDisposition", () => {
  it("enqueues when the branch holds the ticker", () => {
    expect(sellDisposition(10, false)).toBe("enqueue");
    // An open position wins even with another BUY still queued.
    expect(sellDisposition(10, true)).toBe("enqueue");
  });

  it("defers (does not reject) while a BUY for the same ticker is still pending", () => {
    expect(sellDisposition(0, true)).toBe("defer");
  });

  it("rejects no_position only with neither a position nor a pending BUY", () => {
    expect(sellDisposition(0, false)).toBe("reject_no_position");
  });
});
