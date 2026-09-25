import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { replayUpdateData } from "./decisionReviewReplay";

function createPayload(
  overrides: Partial<Prisma.DecisionReviewUncheckedCreateInput> = {},
): Prisma.DecisionReviewUncheckedCreateInput {
  return {
    title: "LUNR — outcome review",
    ticker: null,
    reviewStatus: "PENDING",
    finalVerdict: "TOO_EARLY",
    rulesVersion: "c00610d",
    ruleVersionId: 8,
    branch: "CANDIDATE",
    book: "PAPER",
    idempotencyKey: "CANDIDATE:earnings-CANDIDATE-2026-08-09-LUNR-pre",
    ...overrides,
  };
}

describe("replayUpdateData", () => {
  it("never moves the row across keys, branches or books", () => {
    const out = replayUpdateData(createPayload(), {}, false);
    expect(out).not.toHaveProperty("idempotencyKey");
    expect(out).not.toHaveProperty("branch");
    expect(out).not.toHaveProperty("book");
  });

  it("keeps the row's ticker when the replay omits it (LUNR wipe, 2026-09-20)", () => {
    const out = replayUpdateData(createPayload(), {}, false);
    expect(out).not.toHaveProperty("ticker");
  });

  it("keeps the row's ticker on an explicit null, like every other nullable field", () => {
    const out = replayUpdateData(createPayload(), { ticker: null }, false);
    expect(out).not.toHaveProperty("ticker");
  });

  it("writes a ticker the replay supplies", () => {
    const out = replayUpdateData(createPayload({ ticker: "LUNR" }), { ticker: "LUNR" }, false);
    expect(out.ticker).toBe("LUNR");
  });

  it("does not reset a scored row to PENDING when reviewStatus is omitted", () => {
    const out = replayUpdateData(createPayload(), {}, false);
    expect(out).not.toHaveProperty("reviewStatus");
  });

  it("writes a reviewStatus the replay supplies", () => {
    const out = replayUpdateData(
      createPayload({ reviewStatus: "REVIEWED_1W" }),
      { reviewStatus: "REVIEWED_1W" },
      false,
    );
    expect(out.reviewStatus).toBe("REVIEWED_1W");
  });

  it("keeps the decision's original ruleset on an outcome review", () => {
    const out = replayUpdateData(createPayload(), {}, false);
    expect(out).not.toHaveProperty("ruleVersionId");
    expect(out).not.toHaveProperty("rulesVersion");
    expect(out.finalVerdict).toBe("TOO_EARLY");
  });

  it("re-stamps the ruleset when the replay changes the decision itself", () => {
    const out = replayUpdateData(createPayload(), {}, true);
    expect(out.ruleVersionId).toBe(8);
    expect(out.rulesVersion).toBe("c00610d");
  });
});
