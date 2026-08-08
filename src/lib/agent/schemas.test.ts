import { describe, expect, it } from "vitest";
import {
  branchKeyRejection,
  dailyLogInputSchema,
  logTradeInputSchema,
  patchConfigInputSchema,
  upsertDecisionReviewInputSchema,
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

describe("branchKeyRejection", () => {
  it("flags an own `branch` key on schema-less real-book requests", () => {
    expect(branchKeyRejection({ branch: "CANDIDATE" })?.error).toBe(
      "branch_not_allowed_on_real_book",
    );
    expect(branchKeyRejection({ hard: "true" })).toBeNull();
    expect(branchKeyRejection(null)).toBeNull();
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
