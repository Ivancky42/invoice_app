import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVOLUTION_THRESHOLDS,
  parseEvolutionThresholds,
} from "@/lib/stocks/config";

describe("parseEvolutionThresholds", () => {
  it("returns the code defaults for missing or invalid JSON", () => {
    expect(parseEvolutionThresholds(null)).toEqual(DEFAULT_EVOLUTION_THRESHOLDS);
    expect(parseEvolutionThresholds(undefined)).toEqual(DEFAULT_EVOLUTION_THRESHOLDS);
    expect(parseEvolutionThresholds("not-json")).toEqual(DEFAULT_EVOLUTION_THRESHOLDS);
    expect(parseEvolutionThresholds([])).toEqual(DEFAULT_EVOLUTION_THRESHOLDS);
    expect(parseEvolutionThresholds(12)).toEqual(DEFAULT_EVOLUTION_THRESHOLDS);
  });

  it("returns a fresh object so callers cannot mutate the code defaults", () => {
    const parsed = parseEvolutionThresholds(null);
    parsed.earlyKill.z = 0;
    expect(DEFAULT_EVOLUTION_THRESHOLDS.earlyKill.z).toBe(-1.5);
  });

  it("merges a partial override onto the defaults", () => {
    const parsed = parseEvolutionThresholds({
      earlyKill: { z: -2 },
      minDecisions: { SLOW: 18 },
      promote: { strong: { z: 2.5 } },
    });
    expect(parsed.earlyKill).toEqual({ z: -2, minSessions: 10 });
    expect(parsed.minDecisions).toEqual({ FAST: 10, SLOW: 18 });
    expect(parsed.promote.strong).toEqual({
      z: 2.5,
      minSessions: { FAST: 10, SLOW: 20 },
    });
    expect(parsed.promote.patient).toEqual(DEFAULT_EVOLUTION_THRESHOLDS.promote.patient);
    expect(parsed.inconclusiveSessions).toBe(50);
    expect(parsed.minResolvedNonzeroCredits).toBe(12);
  });
});
