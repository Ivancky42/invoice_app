import { describe, expect, it } from "vitest";
import {
  namespacedDecisionIdempotencyKey,
  validatePaperDecision,
} from "@/lib/shadow/paperValidation";

describe("namespacedDecisionIdempotencyKey", () => {
  it("keeps LIVE/REAL bare", () => {
    expect(namespacedDecisionIdempotencyKey("daily-NVDA", "LIVE", "REAL")).toBe("daily-NVDA");
  });

  it("prefixes CANDIDATE regardless of book", () => {
    expect(namespacedDecisionIdempotencyKey("daily-NVDA", "CANDIDATE", "PAPER")).toBe(
      "CANDIDATE:daily-NVDA",
    );
    expect(namespacedDecisionIdempotencyKey("daily-NVDA", "CANDIDATE", "REAL")).toBe(
      "CANDIDATE:daily-NVDA",
    );
  });

  it("prefixes LIVE/PAPER as LIVE:PAPER:", () => {
    expect(namespacedDecisionIdempotencyKey("daily-NVDA", "LIVE", "PAPER")).toBe(
      "LIVE:PAPER:daily-NVDA",
    );
  });
});

describe("validatePaperDecision", () => {
  const held = new Set(["ISRG", "COIN"]);

  it("skips HOLD / WAIT / AVOID / DO_NOT_AVERAGE_DOWN", () => {
    expect(validatePaperDecision({ decisionType: "WAIT", ticker: "NVDA" }, held)).toBeNull();
    expect(validatePaperDecision({ decisionType: "AVOID", ticker: "NVDA" }, held)).toBeNull();
    expect(validatePaperDecision({ decisionType: "HOLD", ticker: "ISRG" }, held)).toBeNull();
    expect(
      validatePaperDecision({ decisionType: "DO_NOT_AVERAGE_DOWN", ticker: "ISRG" }, held),
    ).toBeNull();
  });

  it("rejects REDUCE / EXIT / ADD / AVERAGE_DOWN without an open paper position", () => {
    const err = validatePaperDecision(
      { decisionType: "REDUCE", ticker: "NVDA", convictionScore: 3 },
      held,
    );
    expect(err?.error).toBe("paper_no_position");
    expect(
      validatePaperDecision({ decisionType: "ADD", ticker: "NVDA", convictionScore: 3 }, held)
        ?.error,
    ).toBe("paper_no_position");
  });

  it("rejects BUY on a ticker the paper book already holds", () => {
    const err = validatePaperDecision(
      { decisionType: "BUY", ticker: "ISRG", convictionScore: 4 },
      held,
    );
    expect(err?.error).toBe("paper_already_held");
    expect(err?.message).toMatch(/ADD/);
  });

  it("requires convictionScore on BUY / ADD / AVERAGE_DOWN", () => {
    expect(
      validatePaperDecision({ decisionType: "BUY", ticker: "NVDA" }, held)?.error,
    ).toBe("paper_conviction_required");
    expect(
      validatePaperDecision({ decisionType: "ADD", ticker: "ISRG" }, held)?.error,
    ).toBe("paper_conviction_required");
    expect(
      validatePaperDecision(
        { decisionType: "AVERAGE_DOWN", ticker: "COIN", convictionScore: 0 },
        held,
      )?.error,
    ).toBe("paper_conviction_required");
  });

  it("empty paper book: REDUCE is paper_no_position, BUY with conviction passes", () => {
    const empty = new Set<string>();
    expect(
      validatePaperDecision({ decisionType: "REDUCE", ticker: "NVDA" }, empty)?.error,
    ).toBe("paper_no_position");
    expect(
      validatePaperDecision({ decisionType: "EXIT", ticker: "ISRG" }, empty)?.error,
    ).toBe("paper_no_position");
    expect(
      validatePaperDecision({ decisionType: "BUY", ticker: "NVDA", convictionScore: 3 }, empty),
    ).toBeNull();
  });

  it("allows a well-formed BUY / ADD / REDUCE", () => {
    expect(
      validatePaperDecision({ decisionType: "BUY", ticker: "NVDA", convictionScore: 3 }, held),
    ).toBeNull();
    expect(
      validatePaperDecision({ decisionType: "ADD", ticker: "ISRG", convictionScore: 4 }, held),
    ).toBeNull();
    expect(validatePaperDecision({ decisionType: "REDUCE", ticker: "COIN" }, held)).toBeNull();
  });
});
