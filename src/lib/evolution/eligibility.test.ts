import { describe, expect, it } from "vitest";
import {
  METRIC_ALLOWLIST,
  checkEligibility,
  hasCounterCase,
  isMeasurableMetric,
  isoWeekKey,
  wasWrongOutcome,
  type EligibilityDecisionRow,
  type EligibilityInput,
} from "@/lib/evolution/eligibility";

const GOOD_COUNTER_CASE =
  "If the wider cap produces two positions that each draw down 15% inside a month, the rail was wrong.";
const GOOD_METRIC = "candidate fitness beats live by 0.002 per session over 20 sessions";

function row(over: Partial<EligibilityDecisionRow> = {}): EligibilityDecisionRow {
  return {
    id: "dr1",
    ticker: "AAA",
    decisionAt: new Date("2026-06-01T00:00:00Z"),
    decisionType: "BUY",
    finalVerdict: "WIN",
    signalQuality: "GOOD",
    ...over,
  };
}

/** Three scored rows, two tickers, two ISO weeks, one LOSS — the minimum passing set. */
function baseRows(): EligibilityDecisionRow[] {
  return [
    row({ id: "a", ticker: "AAA", decisionAt: new Date("2026-06-01T00:00:00Z"), finalVerdict: "LOSS" }),
    row({ id: "b", ticker: "BBB", decisionAt: new Date("2026-06-10T00:00:00Z") }),
    row({ id: "c", ticker: "AAA", decisionAt: new Date("2026-06-11T00:00:00Z") }),
  ];
}

function input(over: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    now: new Date("2026-07-01T00:00:00Z"),
    rows: baseRows(),
    counterCase: GOOD_COUNTER_CASE,
    successMetric: GOOD_METRIC,
    reasoningPattern: "wider single-position cap improves compounding",
    loosens: false,
    worstCase: null,
    changedPaths: ["limits:/singlePositionPct"],
    recentlyRetired: [],
    retiredPatterns: [],
    ...over,
  };
}

describe("wasWrongOutcome", () => {
  const truthTable: Array<[string, EligibilityDecisionRow, boolean]> = [
    ["WIN + GOOD is not wrong", row(), false],
    ["LOSS is wrong", row({ finalVerdict: "LOSS" }), true],
    ["POOR signal is wrong even on a WIN", row({ signalQuality: "POOR" }), true],
    ["AVOIDED_LOSS is a correct refusal", row({ finalVerdict: "AVOIDED_LOSS" }), false],
    ["NEUTRAL is not wrong", row({ finalVerdict: "NEUTRAL" }), false],
    ["TOO_EARLY is unresolved, not wrong", row({ finalVerdict: "TOO_EARLY" }), false],
    [
      "AVOID with a negative credit is wrong (the name ran)",
      row({ decisionType: "AVOID", finalVerdict: "NEUTRAL", counterfactualCredit: -0.004 }),
      true,
    ],
    [
      "AVOID with a positive credit is right (the name fell)",
      row({ decisionType: "AVOID", finalVerdict: "NEUTRAL", counterfactualCredit: 0.004 }),
      false,
    ],
    [
      "DO_NOT_AVERAGE_DOWN with a negative credit is wrong",
      row({
        decisionType: "DO_NOT_AVERAGE_DOWN",
        finalVerdict: "NEUTRAL",
        counterfactualCredit: -0.001,
      }),
      true,
    ],
    [
      "an ACTED decision with a negative credit is NOT judged by the counterfactual",
      row({ decisionType: "BUY", finalVerdict: "NEUTRAL", counterfactualCredit: -0.01 }),
      false,
    ],
    [
      "an AVOID with no resolved credit is not wrong",
      row({ decisionType: "AVOID", finalVerdict: "NEUTRAL", counterfactualCredit: null }),
      false,
    ],
  ];

  for (const [label, r, expected] of truthTable) {
    it(label, () => expect(wasWrongOutcome(r)).toBe(expected));
  }

  it("prefers an explicitly passed credit over the row's own", () => {
    const r = row({ decisionType: "AVOID", finalVerdict: "NEUTRAL", counterfactualCredit: 0.1 });
    expect(wasWrongOutcome(r, -0.1)).toBe(true);
  });
});

describe("isoWeekKey", () => {
  it("puts Mon..Sun of the same week in one bucket", () => {
    expect(isoWeekKey(new Date("2026-06-08T00:00:00Z"))).toBe(
      isoWeekKey(new Date("2026-06-14T00:00:00Z")),
    );
  });
  it("separates adjacent weeks", () => {
    expect(isoWeekKey(new Date("2026-06-14T00:00:00Z"))).not.toBe(
      isoWeekKey(new Date("2026-06-15T00:00:00Z")),
    );
  });
});

describe("isMeasurableMetric", () => {
  it("needs both a number and an allowlisted term", () => {
    expect(isMeasurableMetric("fitness improves")).toBe(false);
    expect(isMeasurableMetric("improves by 12")).toBe(false);
    expect(isMeasurableMetric("drawdown under 0.08")).toBe(true);
  });

  it("accepts every allowlisted term when paired with a number", () => {
    for (const term of METRIC_ALLOWLIST) {
      expect(isMeasurableMetric(`${term} reaches 2`)).toBe(true);
    }
  });

  it("does not match a bare z inside another word", () => {
    expect(isMeasurableMetric("position size grows by 2")).toBe(false);
    expect(isMeasurableMetric("z >= 2 after 20 sessions")).toBe(true);
  });
});

describe("hasCounterCase", () => {
  it("rejects non-answers and short text", () => {
    expect(hasCounterCase("none")).toBe(false);
    expect(hasCounterCase("n/a")).toBe(false);
    expect(hasCounterCase("-")).toBe(false);
    expect(hasCounterCase("it might not work")).toBe(false);
  });
  it("accepts a real falsification condition", () => {
    expect(hasCounterCase(GOOD_COUNTER_CASE)).toBe(true);
  });
});

describe("checkEligibility", () => {
  it("passes the minimum viable evidence set", () => {
    const result = checkEligibility(input());
    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({ scoredRows: 3, tickers: 2, isoWeeks: 2, wrongOutcomes: 1 });
  });

  it("insufficient_evidence: unscored rows do not count", () => {
    const rows = baseRows();
    rows[2] = { ...rows[2], finalVerdict: null };
    const result = checkEligibility(input({ rows }));
    expect(result).toMatchObject({ ok: false, code: "insufficient_evidence" });
  });

  it("evidence_not_diverse: one ticker", () => {
    const rows = baseRows().map((r) => ({ ...r, ticker: "AAA" }));
    expect(checkEligibility(input({ rows }))).toMatchObject({
      ok: false,
      code: "evidence_not_diverse",
    });
  });

  it("evidence_not_diverse: one ISO week", () => {
    const rows = baseRows().map((r) => ({ ...r, decisionAt: new Date("2026-06-01T00:00:00Z") }));
    expect(checkEligibility(input({ rows }))).toMatchObject({
      ok: false,
      code: "evidence_not_diverse",
    });
  });

  it("no_wrong_outcome: everything went right", () => {
    const rows = baseRows().map((r) => ({ ...r, finalVerdict: "WIN" as const }));
    expect(checkEligibility(input({ rows }))).toMatchObject({
      ok: false,
      code: "no_wrong_outcome",
    });
  });

  it("counter_case_missing", () => {
    expect(checkEligibility(input({ counterCase: "none" }))).toMatchObject({
      ok: false,
      code: "counter_case_missing",
    });
  });

  it("success_metric_not_measurable and it names the allowlist", () => {
    const result = checkEligibility(input({ successMetric: "the book feels calmer" }));
    expect(result).toMatchObject({ ok: false, code: "success_metric_not_measurable" });
    expect(
      (result as unknown as { detail: { allowedTerms: string[] } }).detail.allowedTerms,
    ).toContain("fitness");
  });

  it("loosening_evidence_bar: 3 rows over 10 days is not enough to loosen", () => {
    expect(checkEligibility(input({ loosens: true, worstCase: "two 15% drawdowns" }))).toMatchObject(
      { ok: false, code: "loosening_evidence_bar" },
    );
  });

  it("loosening_evidence_bar: enough rows and span but no worstCase", () => {
    const rows = [
      ...baseRows(),
      row({ id: "d", ticker: "CCC", decisionAt: new Date("2026-06-20T00:00:00Z") }),
      row({ id: "e", ticker: "DDD", decisionAt: new Date("2026-07-20T00:00:00Z") }),
    ];
    expect(checkEligibility(input({ rows, loosens: true, worstCase: "  " }))).toMatchObject({
      ok: false,
      code: "loosening_evidence_bar",
    });
  });

  it("loosening passes with 5 rows, a 42+ day span and a worstCase", () => {
    const rows = [
      ...baseRows(),
      row({ id: "d", ticker: "CCC", decisionAt: new Date("2026-06-20T00:00:00Z") }),
      row({ id: "e", ticker: "DDD", decisionAt: new Date("2026-07-20T00:00:00Z") }),
    ];
    expect(
      checkEligibility(input({ rows, loosens: true, worstCase: "two names down 15% at once" })).ok,
    ).toBe(true);
  });

  it("pattern_retired blocks a reasoningPattern that already failed twice", () => {
    expect(
      checkEligibility(
        input({ retiredPatterns: ["wider single-position cap improves compounding"] }),
      ),
    ).toMatchObject({ ok: false, code: "pattern_retired" });
  });

  it("reproposal_banned when a recently killed version touched the same path", () => {
    const result = checkEligibility(
      input({
        recentlyRetired: [
          {
            id: 7,
            changedPaths: ["limits:/singlePositionPct"],
            retiredAt: new Date("2026-06-20T00:00:00Z"),
            reasoningPattern: "something else",
          },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "reproposal_banned" });
    expect(
      (result as unknown as { detail: { blockedByVersionId: number } }).detail.blockedByVersionId,
    ).toBe(7);
  });

  it("the ban lifts when an evidence row postdates the failed version's retirement", () => {
    const rows = [
      ...baseRows(),
      row({ id: "d", ticker: "CCC", decisionAt: new Date("2026-06-25T00:00:00Z") }),
    ];
    expect(
      checkEligibility(
        input({
          rows,
          recentlyRetired: [
            {
              id: 7,
              changedPaths: ["limits:/singlePositionPct"],
              retiredAt: new Date("2026-06-20T00:00:00Z"),
              reasoningPattern: null,
            },
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  it("a version retired more than 90 days ago does not ban", () => {
    expect(
      checkEligibility(
        input({
          recentlyRetired: [
            {
              id: 7,
              changedPaths: ["limits:/singlePositionPct"],
              retiredAt: new Date("2026-01-01T00:00:00Z"),
              reasoningPattern: null,
            },
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  it("a non-overlapping path does not ban", () => {
    expect(
      checkEligibility(
        input({
          recentlyRetired: [
            {
              id: 7,
              changedPaths: ["limits:/cashFloorPct"],
              retiredAt: new Date("2026-06-20T00:00:00Z"),
              reasoningPattern: null,
            },
          ],
        }),
      ).ok,
    ).toBe(true);
  });
});
