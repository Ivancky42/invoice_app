import { describe, expect, it } from "vitest";
import {
  branchKeyRejection,
  dailyLogInputSchema,
  evidenceItemInputSchema,
  getContextInputSchema,
  listDecisionReviewsQuerySchema,
  logTradeInputSchema,
  patchConfigInputSchema,
  patchPortfolioInputSchema,
  upsertDecisionReviewInputSchema,
  upsertIdeaInputSchema,
  upsertWatchlistInputSchema,
  validationFailure,
} from "@/lib/agent/schemas";

const trade = {
  idempotencyKey: "k1",
  ticker: "NVDA",
  type: "BUY",
  date: "2026-08-06",
  shares: 1,
  pricePerShare: 100,
};

describe("real-book writes reject a branch key", () => {
  it("400s log_trade input carrying branch, with a named error", () => {
    const parsed = logTradeInputSchema.safeParse({ ...trade, branch: "CANDIDATE" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(validationFailure(parsed.error).error).toBe("branch_not_allowed_on_real_book");
  });

  it("400s even when branch is LIVE — the key itself is not part of the contract", () => {
    expect(logTradeInputSchema.safeParse({ ...trade, branch: "LIVE" }).success).toBe(false);
  });

  it("still accepts a real-book write without the key", () => {
    expect(logTradeInputSchema.safeParse(trade).success).toBe(true);
    expect(upsertWatchlistInputSchema.safeParse({ ticker: "NVDA" }).success).toBe(true);
  });

  it("rejects branch on upsert_watchlist too", () => {
    expect(
      upsertWatchlistInputSchema.safeParse({ ticker: "NVDA", branch: "CANDIDATE" }).success,
    ).toBe(false);
  });

  it("400s a Config patch carrying branch — Config holds real cash / TRACKED_TICKERS", () => {
    const parsed = patchConfigInputSchema.safeParse({
      CASH_POSITION_USD: 1000,
      branch: "CANDIDATE",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(validationFailure(parsed.error).error).toBe("branch_not_allowed_on_real_book");
    expect(patchConfigInputSchema.safeParse({ CASH_POSITION_USD: 1000 }).success).toBe(true);
  });
});

describe("decision review idempotency keys", () => {
  const key = (idempotencyKey: string) =>
    upsertDecisionReviewInputSchema.safeParse({ title: "t", idempotencyKey });

  it("refuses a caller key carrying a reserved branch prefix", () => {
    const parsed = key("CANDIDATE:daily-2026-08-08-NVDA");
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(validationFailure(parsed.error).error).toBe("reserved_idempotency_key_prefix");
    expect(key("LIVE:daily-2026-08-08-NVDA").success).toBe(false);
    // Case and leading whitespace must not smuggle the prefix past the guard.
    expect(key("candidate:x").success).toBe(false);
    expect(key("  CANDIDATE:x").success).toBe(false);
  });

  it("still accepts ordinary keys, including ones merely containing the word", () => {
    expect(key("daily-2026-08-08-NVDA").success).toBe(true);
    expect(key("review-CANDIDATE:x").success).toBe(true);
  });
});

describe("branch-aware writes accept a branch", () => {
  it("takes LIVE / CANDIDATE and defaults to absent", () => {
    expect(dailyLogInputSchema.safeParse({ logDate: "2026-08-06" }).success).toBe(true);
    expect(
      dailyLogInputSchema.safeParse({ logDate: "2026-08-06", branch: "CANDIDATE" }).success,
    ).toBe(true);
    expect(
      upsertDecisionReviewInputSchema.safeParse({ title: "t", branch: "LIVE" }).success,
    ).toBe(true);
  });

  it("refuses an unknown branch value", () => {
    expect(
      dailyLogInputSchema.safeParse({ logDate: "2026-08-06", branch: "SHADOW" }).success,
    ).toBe(false);
  });
});

describe("zone / foundVia write limits", () => {
  it("accepts an entryZone / addZone that used to 400 at 500 chars", () => {
    const zone = "x".repeat(501);
    expect(patchPortfolioInputSchema.safeParse({ addZone: zone }).success).toBe(true);
    expect(upsertWatchlistInputSchema.safeParse({ ticker: "OKLO", entryZone: zone }).success).toBe(
      true,
    );
    expect(patchPortfolioInputSchema.safeParse({ addZone: "x".repeat(2001) }).success).toBe(false);
  });

  it("accepts a beatRate recap longer than 200 chars", () => {
    expect(patchPortfolioInputSchema.safeParse({ beatRate: "x".repeat(201) }).success).toBe(true);
    expect(patchPortfolioInputSchema.safeParse({ beatRate: "x".repeat(1001) }).success).toBe(false);
  });

  it("accepts a foundVia note longer than 200 chars", () => {
    expect(
      upsertIdeaInputSchema.safeParse({
        stockSector: "WDAY",
        foundVia: "x".repeat(201),
      }).success,
    ).toBe(true);
    expect(
      upsertIdeaInputSchema.safeParse({
        stockSector: "WDAY",
        foundVia: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });
});

describe("branchKeyRejection", () => {
  it("flags an own `branch` key on schema-less real-book requests", () => {
    expect(branchKeyRejection({ branch: "CANDIDATE" })?.error).toBe(
      "branch_not_allowed_on_real_book",
    );
    expect(branchKeyRejection({ hard: "true" })).toBeNull();
    expect(branchKeyRejection(null)).toBeNull();
  });
});

describe("decision book on context / review schemas", () => {
  it("accepts REAL / PAPER / omitted on get_context, upsert_decision_review, list_decision_reviews", () => {
    expect(
      getContextInputSchema.safeParse({ routine: "daily", book: "PAPER" }).success,
    ).toBe(true);
    expect(
      getContextInputSchema.safeParse({ routine: "daily", book: "REAL" }).success,
    ).toBe(true);
    expect(getContextInputSchema.safeParse({ routine: "daily" }).success).toBe(true);
    expect(
      upsertDecisionReviewInputSchema.safeParse({ title: "t", book: "PAPER" }).success,
    ).toBe(true);
    expect(listDecisionReviewsQuerySchema.safeParse({ book: "REAL" }).success).toBe(true);
  });

  it("rejects an unknown book value", () => {
    expect(getContextInputSchema.safeParse({ routine: "daily", book: "SHADOW" }).success).toBe(
      false,
    );
    expect(
      upsertDecisionReviewInputSchema.safeParse({ title: "t", book: "LIVE" }).success,
    ).toBe(false);
    expect(listDecisionReviewsQuerySchema.safeParse({ book: "CANDIDATE" }).success).toBe(false);
  });
});

describe("decision review thesis state", () => {
  it("accepts thesisState and priorThesisState", () => {
    const parsed = upsertDecisionReviewInputSchema.safeParse({
      title: "t",
      thesisState: "WEAKENING",
      priorThesisState: "INTACT",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.thesisState).toBe("WEAKENING");
    expect(parsed.data.priorThesisState).toBe("INTACT");
  });

  it("rejects an unknown thesisState value", () => {
    expect(
      upsertDecisionReviewInputSchema.safeParse({ title: "t", thesisState: "MOSTLY_FINE" })
        .success,
    ).toBe(false);
  });

  it("normalizes a session-label observedAt to the leading YYYY-MM-DD", () => {
    const parsed = evidenceItemInputSchema.safeParse({
      tier: "T1",
      kind: "FILING",
      summary: "GEV pyramid trigger re-checked on the session close.",
      observedAt: "2026-08-11 US close",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.observedAt).toBe("2026-08-11");
  });

  it("still accepts a plain date or ISO datetime for observedAt", () => {
    expect(
      evidenceItemInputSchema.safeParse({
        tier: "T1",
        kind: "FILING",
        summary: "Plain date is already a valid observedAt.",
        observedAt: "2026-08-11",
      }).success,
    ).toBe(true);
    expect(
      evidenceItemInputSchema.safeParse({
        tier: "T1",
        kind: "FILING",
        summary: "ISO datetime is already a valid observedAt.",
        observedAt: "2026-08-11T20:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an observedAt that is not a date", () => {
    expect(
      evidenceItemInputSchema.safeParse({
        tier: "T1",
        kind: "FILING",
        summary: "A prose timestamp is not parseable as observedAt.",
        observedAt: "last Tuesday",
      }).success,
    ).toBe(false);
  });

  it("moveClass is server-computed and never survives parsing, even when supplied", () => {
    // Unknown keys are stripped by zod's default (non-strict) object parsing, so this
    // asserts the PARSED OUTPUT never carries moveClass — not that the input was refused.
    const parsed = upsertDecisionReviewInputSchema.safeParse({
      title: "t",
      moveClass: "MARKET_MOVE",
      breadth: 0.9,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("moveClass");
    expect(parsed.data).not.toHaveProperty("breadth");
  });
});
