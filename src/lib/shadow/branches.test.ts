import { describe, expect, it } from "vitest";
import { cloneRestartNav } from "@/lib/shadow/branches";

describe("cloneRestartNav", () => {
  it("is cash alone when there are no open positions", () => {
    expect(cloneRestartNav([], 100_000)).toBe(100_000);
  });

  it("adds marked positions at lastMark", () => {
    expect(
      cloneRestartNav([{ shares: 100, lastMark: 100, avgCost: 80 }], 50_000),
    ).toBe(60_000);
  });

  it("falls back to avgCost when lastMark is missing", () => {
    expect(
      cloneRestartNav([{ shares: 10, lastMark: null, avgCost: 25 }], 1_000),
    ).toBe(1_250);
  });

  it("sums several names and is what startNav / highWaterNav both receive", () => {
    const nav = cloneRestartNav(
      [
        { shares: 2, lastMark: 200, avgCost: 150 },
        { shares: 5, lastMark: null, avgCost: 40 },
      ],
      10_000,
    );
    expect(nav).toBe(10_600);
  });
});
