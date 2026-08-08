import { describe, expect, it } from "vitest";
import {
  FAST_LANE_PARAMS,
  LIMITS_PARAMS,
  applyPointer,
  changedLimitsPaths,
  fastLaneParam,
  isFastLaneParam,
  isKnownLimitsPath,
  limitsParam,
  resolvePointer,
} from "@/lib/evolution/parameters";
import { driftGuard } from "@/lib/fitness/math";
import { DEFAULT_LIMITS } from "@/lib/stocks/config";

/** Every JSON pointer to a NUMBER anywhere in a limits object. */
function numericPointers(node: unknown, prefix = ""): string[] {
  if (typeof node === "number") return [prefix];
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => numericPointers(child, `${prefix}/${i}`));
  }
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
      numericPointers(child, `${prefix}/${key}`),
    );
  }
  return [];
}

describe("resolvePointer", () => {
  it("reads a top-level numeric rail", () => {
    expect(resolvePointer(DEFAULT_LIMITS, "/singlePositionPct")).toBe(0.15);
    expect(resolvePointer(DEFAULT_LIMITS, "/maxAverageDowns")).toBe(2);
  });

  it("reads into tierBands array slots", () => {
    expect(resolvePointer(DEFAULT_LIMITS, "/tierBands/TEST_STARTER/1")).toBe(0.03);
    expect(resolvePointer(DEFAULT_LIMITS, "/tierBands/CONFIRMATION/1")).toBe(0.06);
    expect(resolvePointer(DEFAULT_LIMITS, "/tierBands/CONVICTION/1")).toBe(0.08);
    expect(resolvePointer(DEFAULT_LIMITS, "/tierBands/CONVICTION/0")).toBe(0);
  });

  it("throws on an unknown path", () => {
    expect(() => resolvePointer(DEFAULT_LIMITS, "/nope")).toThrow(/unknown_limits_path/);
    expect(() => resolvePointer(DEFAULT_LIMITS, "/tierBands/NOPE/1")).toThrow(
      /unknown_limits_path/,
    );
    expect(() => resolvePointer(DEFAULT_LIMITS, "/tierBands/CONVICTION/9")).toThrow(
      /unknown_limits_path/,
    );
  });

  it("throws on a non-numeric target", () => {
    // tierBands itself is an object, not a rail.
    expect(() => resolvePointer(DEFAULT_LIMITS, "/tierBands")).toThrow(/unknown_limits_path/);
  });

  it("rejects a malformed pointer", () => {
    expect(() => resolvePointer(DEFAULT_LIMITS, "singlePositionPct")).toThrow(/invalid pointer/);
    expect(() => resolvePointer(DEFAULT_LIMITS, "")).toThrow(/invalid pointer/);
  });
});

describe("applyPointer", () => {
  it("returns a copy and never mutates the input", () => {
    const next = applyPointer(DEFAULT_LIMITS, "/singlePositionPct", 0.18);
    expect(next.singlePositionPct).toBe(0.18);
    expect(DEFAULT_LIMITS.singlePositionPct).toBe(0.15);
    expect(next).not.toBe(DEFAULT_LIMITS);
  });

  it("writes a tierBands slot without disturbing its sibling", () => {
    const next = applyPointer(DEFAULT_LIMITS, "/tierBands/CONVICTION/1", 0.1);
    expect(next.tierBands.CONVICTION).toEqual([0, 0.1]);
    expect(next.tierBands.CONFIRMATION).toEqual(DEFAULT_LIMITS.tierBands.CONFIRMATION);
    expect(DEFAULT_LIMITS.tierBands.CONVICTION).toEqual([0, 0.08]);
  });

  it("composes: two changes both survive", () => {
    const once = applyPointer(DEFAULT_LIMITS, "/singlePositionPct", 0.18);
    const twice = applyPointer(once, "/cashFloorPct", 0.03);
    expect(twice.singlePositionPct).toBe(0.18);
    expect(twice.cashFloorPct).toBe(0.03);
  });

  it("refuses unknown paths and non-finite values", () => {
    expect(() => applyPointer(DEFAULT_LIMITS, "/nope", 1)).toThrow(/unknown_limits_path/);
    expect(() => applyPointer(DEFAULT_LIMITS, "/singlePositionPct", Number.NaN)).toThrow(
      /invalid_limits_value/,
    );
  });
});

describe("LIMITS_PARAMS registry", () => {
  /**
   * THE bypass guard. An unregistered numeric rail reaches Config.LIMITS on promotion
   * having passed no hard range, no drift rail and no loosening bar. If this test fails
   * because a limits key was added, add its registry entry — do not relax the assertion.
   */
  it("covers EVERY numeric leaf in DEFAULT_LIMITS", () => {
    const registered = new Set(LIMITS_PARAMS.map((p) => p.path));
    const missing = numericPointers(DEFAULT_LIMITS).filter((p) => !registered.has(p));
    expect(missing).toEqual([]);
  });

  it("registers nothing that is not a real numeric rail", () => {
    for (const param of LIMITS_PARAMS) {
      expect(() => resolvePointer(DEFAULT_LIMITS, param.path)).not.toThrow();
    }
  });

  it("every default value sits inside its own hard range", () => {
    for (const param of LIMITS_PARAMS) {
      const value = resolvePointer(DEFAULT_LIMITS, param.path);
      expect(value).toBeGreaterThanOrEqual(param.hardRange[0]);
      expect(value).toBeLessThanOrEqual(param.hardRange[1]);
    }
  });

  it("has no duplicate paths and well-ordered ranges", () => {
    const paths = LIMITS_PARAMS.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const param of LIMITS_PARAMS) {
      expect(param.hardRange[0]).toBeLessThan(param.hardRange[1]);
    }
  });

  it("a band FLOOR is SLOW-lane but still hard-range checked", () => {
    const floor = limitsParam("/tierBands/TEST_STARTER/0");
    expect(floor?.lane).toBe("SLOW");
    // The exact bypass that used to neuter logTrade's band check on the real book.
    expect(
      driftGuard({
        paramPath: "/tierBands/TEST_STARTER/0",
        hardRange: floor!.hardRange,
        proposed: 0.9,
        valueAt90dAgo: 0.02,
        valueAtV1: 0.02,
        consecutiveLoosenings: 0,
        looseningDirection: floor!.looseningDirection,
      }),
    ).toEqual({ allowed: false, code: "HARD_RANGE" });
  });

  it("an unregistered pointer is not a known rail", () => {
    expect(isKnownLimitsPath("/singlePositionPct")).toBe(true);
    expect(isKnownLimitsPath("/entryZoneWidthPct")).toBe(true);
    expect(isKnownLimitsPath("/nope")).toBe(false);
    expect(limitsParam("/nope")).toBeUndefined();
  });
});

describe("FAST_LANE_PARAMS", () => {
  it("is exactly the lane===FAST slice of the registry", () => {
    expect(FAST_LANE_PARAMS.map((p) => p.path)).toEqual(
      LIMITS_PARAMS.filter((p) => p.lane === "FAST").map((p) => p.path),
    );
    expect(FAST_LANE_PARAMS.every((p) => p.lane === "FAST")).toBe(true);
  });

  it("every whitelisted pointer resolves against DEFAULT_LIMITS", () => {
    for (const param of FAST_LANE_PARAMS) {
      expect(() => resolvePointer(DEFAULT_LIMITS, param.path)).not.toThrow();
    }
  });

  it("every default value sits inside its own hard range", () => {
    for (const param of FAST_LANE_PARAMS) {
      const value = resolvePointer(DEFAULT_LIMITS, param.path);
      expect(value).toBeGreaterThanOrEqual(param.hardRange[0]);
      expect(value).toBeLessThanOrEqual(param.hardRange[1]);
    }
  });

  it("has no duplicate paths and a well-ordered range", () => {
    const paths = FAST_LANE_PARAMS.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const param of FAST_LANE_PARAMS) {
      expect(param.hardRange[0]).toBeLessThan(param.hardRange[1]);
    }
  });

  it("lookup helpers agree with the table", () => {
    expect(isFastLaneParam("/singlePositionPct")).toBe(true);
    // Registered, but SLOW — known to the registry, still off the fast lane.
    expect(isFastLaneParam("/entryZoneWidthPct")).toBe(false);
    expect(isFastLaneParam("/nope")).toBe(false);
    expect(fastLaneParam("/cashFloorPct")?.looseningDirection).toBe("DOWN");
    expect(fastLaneParam("/entryZoneWidthPct")).toBeUndefined();
  });
});

describe("changedLimitsPaths", () => {
  it("reports only pointers whose value actually moved", () => {
    const after = applyPointer(DEFAULT_LIMITS, "/singlePositionPct", 0.18);
    expect(
      changedLimitsPaths(DEFAULT_LIMITS, after, ["/singlePositionPct", "/cashFloorPct"]),
    ).toEqual(["/singlePositionPct"]);
  });

  it("drops a no-op change (same value written back)", () => {
    const after = applyPointer(DEFAULT_LIMITS, "/singlePositionPct", 0.15);
    expect(changedLimitsPaths(DEFAULT_LIMITS, after, ["/singlePositionPct"])).toEqual([]);
  });
});
