import { describe, expect, it } from "vitest";
import type { EvolutionEventKind } from "@/generated/prisma/client";
import { DEFAULT_EVOLUTION_THRESHOLDS } from "@/lib/stocks/config";
import {
  addUsTradingDays,
  buildPromotionGates,
  buildVerdictSentence,
  firstSentence,
  isHistoryVisible,
  normalCdfPct,
  projectEarliestDecisionDate,
  rebaseNavSeries,
  translateEvolutionEvent,
  type PromotionGateInput,
} from "@/lib/shadow/summaryMath";

describe("normalCdfPct (Φ)", () => {
  it("maps the textbook z values to the expected one-sided percentages", () => {
    expect(normalCdfPct(0)).toBeCloseTo(50, 5);
    expect(normalCdfPct(1.96)).toBeCloseTo(97.5, 1);
    expect(normalCdfPct(2.0)).toBeCloseTo(97.7, 1);
    expect(normalCdfPct(1.75)).toBeCloseTo(96.0, 1);
  });
});

describe("rebaseNavSeries", () => {
  it("sets the first point to 100 and scales the rest", () => {
    const rebased = rebaseNavSeries([
      { session: "2026-09-01", nav: 50_000 },
      { session: "2026-09-02", nav: 55_000 },
      { session: "2026-09-03", nav: 45_000 },
    ]);
    expect(rebased[0]?.value).toBe(100);
    expect(rebased[1]?.value).toBeCloseTo(110, 8);
    expect(rebased[2]?.value).toBeCloseTo(90, 8);
  });

  it("skips a non-positive first NAV and rebases from the first usable point", () => {
    const rebased = rebaseNavSeries([
      { session: "2026-09-01", nav: 0 },
      { session: "2026-09-02", nav: 80_000 },
      { session: "2026-09-03", nav: 88_000 },
    ]);
    expect(rebased).toHaveLength(2);
    expect(rebased[0]).toEqual({ session: "2026-09-02", value: 100 });
    expect(rebased[1]?.value).toBeCloseTo(110, 8);
  });
});

describe("addUsTradingDays / projectEarliestDecisionDate", () => {
  it("skips Saturday and Sunday", () => {
    // Friday 4 Sep 2026 + 1 trading day → Monday 7 Sep.
    expect(addUsTradingDays("2026-09-04", 1)).toBe("2026-09-07");
    // Friday + 8 trading days → Wednesday 16 Sep (skip 5–6 and 12–13).
    expect(addUsTradingDays("2026-09-04", 8)).toBe("2026-09-16");
  });

  it("returns the latest session when no more days are needed", () => {
    expect(projectEarliestDecisionDate("2026-09-04", 0)).toBe("2026-09-04");
    expect(projectEarliestDecisionDate("2026-09-04", -3)).toBe("2026-09-04");
  });

  it("returns null when there is no latest session", () => {
    expect(projectEarliestDecisionDate(null, 5)).toBeNull();
  });
});

describe("buildVerdictSentence", () => {
  const running = {
    status: "RUNNING" as const,
    incumbentVersionId: 5,
    challengerVersionId: 6,
    testStart: "2026-09-04",
    sessionsDone: 12,
    sessionsNeeded: 20,
    deltaPct: 0.008,
    z: 1.34,
    confidencePct: 91,
    confidenceNeededStrongPct: 97.7,
    earliestDecisionDate: "2026-09-22",
  };

  it("IDLE names the current rules and says nothing is being tested", () => {
    expect(
      buildVerdictSentence({
        ...running,
        status: "IDLE",
        challengerVersionId: null,
      }),
    ).toBe("No new rules are being tested right now. Current rules: v5.");
  });

  it("RUNNING ahead lists days, edge, confidence, and earliest date", () => {
    const s = buildVerdictSentence(running);
    expect(s).toContain("Testing v6 against v5 since 4 Sep");
    expect(s).toContain("12 of 20 trading days done");
    expect(s).toContain("v6 is ahead by 0.8%");
    expect(s).toContain("confidence 91%");
    expect(s).toContain("need 98%");
    expect(s).toContain("Earliest decision around 22 Sep");
  });

  it("RUNNING behind says behind", () => {
    expect(buildVerdictSentence({ ...running, deltaPct: -0.004 })).toContain(
      "v6 is behind by 0.4%",
    );
  });

  it("z null says there is not enough data yet", () => {
    expect(
      buildVerdictSentence({ ...running, z: null, confidencePct: null }),
    ).toContain("Not enough data yet to compare.");
  });

  it("PAUSED appends the auto-promote sentence", () => {
    const s = buildVerdictSentence({ ...running, status: "PAUSED" });
    expect(s).toContain("Testing v6 against v5");
    expect(s).toContain(
      "Auto-promote is switched off, so nothing will change until it is turned on.",
    );
  });
});

describe("translateEvolutionEvent", () => {
  const kinds: EvolutionEventKind[] = [
    "PROPOSE",
    "PROMOTE",
    "EARLY_KILL",
    "HARD_REVERT",
    "INCONCLUSIVE",
    "SCORE",
    "GAPFIX",
    "ELIGIBILITY_REJECT",
    "DRIFT_BLOCK",
    "KERNEL_ATTEMPT",
    "PATTERN_RETIRED",
    "MIRROR",
  ];

  it("covers every kind with a plain sentence", () => {
    for (const kind of kinds) {
      const sentence = translateEvolutionEvent(kind, 6, {
        changeSummary: "Tighten the stop on speculative names.",
      });
      expect(sentence.length).toBeGreaterThan(8);
      expect(sentence).not.toMatch(/_/);
    }
  });

  it("uses the specified wording for the main lifecycle kinds", () => {
    expect(translateEvolutionEvent("PROPOSE", 6, { changeSummary: "Widen the band." })).toBe(
      "New rules v6 proposed: Widen the band.",
    );
    expect(translateEvolutionEvent("PROMOTE", 6, {})).toBe("v6 became the current rules");
    expect(translateEvolutionEvent("EARLY_KILL", 6, {})).toBe(
      "v6 was stopped early: it was doing worse",
    );
    expect(translateEvolutionEvent("HARD_REVERT", 6, {})).toBe(
      "v6 was reverted: lost more than 25% from its peak",
    );
    expect(translateEvolutionEvent("INCONCLUSIVE", 6, {})).toBe(
      "v6 test ended with no clear winner",
    );
  });

  it("does not call a rebase kill a loss, and names a human publish", () => {
    expect(
      translateEvolutionEvent("EARLY_KILL", 6, { reason: "rebased", newCandidateId: 8 }),
    ).toBe("v6 continued as v8 after the current rules were updated");
    expect(translateEvolutionEvent("EARLY_KILL", 6, { reason: "rebase_conflict" })).toBe(
      "v6 was withdrawn: the current rules changed in the same place",
    );
    expect(translateEvolutionEvent("GAPFIX", 7, { human: true })).toBe(
      "Ivan published an edit to the rules as v7",
    );
    expect(translateEvolutionEvent("GAPFIX", 7, {})).toBe("A small fix was applied to v7");
  });

  it("hides archive and scoring bookkeeping from History", () => {
    expect(isHistoryVisible("MIRROR")).toBe(false);
    expect(isHistoryVisible("SCORE")).toBe(false);
    expect(isHistoryVisible("PROMOTE")).toBe(true);
    expect(isHistoryVisible("EARLY_KILL")).toBe(true);
  });
});

describe("buildPromotionGates", () => {
  const t = DEFAULT_EVOLUTION_THRESHOLDS;
  const promoteReady: PromotionGateInput = {
    sessionsDone: t.promote.strong.minSessions.SLOW,
    sessionsNeeded: t.promote.strong.minSessions.SLOW,
    patientSessionsNeeded: t.promote.patient.minSessions,
    confidencePct: normalCdfPct(t.promote.strong.z),
    confidenceNeededStrongPct: normalCdfPct(t.promote.strong.z),
    confidenceNeededPatientPct: normalCdfPct(t.promote.patient.z),
    candidateDecisions: t.minDecisions.SLOW,
    liveDecisions: t.minDecisions.SLOW,
    minDecisions: t.minDecisions.SLOW,
    candidateMaxDrawdown: 0.04,
    liveMaxDrawdown: 0.04,
    resolvedCredits: t.minResolvedNonzeroCredits,
    minResolvedCredits: t.minResolvedNonzeroCredits,
    turnoverSessions: t.minTurnoverSessions,
    minTurnoverSessions: t.minTurnoverSessions,
    promoteSwitchOn: true,
  };

  it("marks every gate ok on PROMOTE-ready inputs", () => {
    const gates = buildPromotionGates(promoteReady);
    expect(gates.every((g) => g.ok)).toBe(true);
    expect(gates.map((g) => g.id)).toEqual([
      "sessions",
      "confidence",
      "decisions",
      "drawdown",
      "credits",
      "turnover",
      "switch",
    ]);
  });

  it("fails the days gate when short of the strong minimum", () => {
    const gates = buildPromotionGates({ ...promoteReady, sessionsDone: 12 });
    expect(gates.find((g) => g.id === "sessions")?.ok).toBe(false);
    expect(gates.find((g) => g.id === "sessions")?.note).toMatch(/30 days at 96%/);
  });
});

describe("firstSentence", () => {
  it("takes the first sentence and caps length", () => {
    expect(firstSentence("Widen the band. Then wait.")).toBe("Widen the band.");
    expect(firstSentence("x".repeat(200)).length).toBe(140);
  });
});
