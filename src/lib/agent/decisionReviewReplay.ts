import type { Prisma } from "@/generated/prisma/client";

/**
 * Narrow a DecisionReview create payload to what an idempotent replay (update by
 * idempotencyKey) may change. Pure — no Prisma client — so the rules are unit-tested.
 *
 * - `idempotencyKey`, `branch`, `book` never move: a replay must not flip a PAPER row onto
 *   REAL or a CANDIDATE row onto LIVE.
 * - `ticker` / `reviewStatus`: omitted (or null) keeps the row's value. The create payload
 *   fills these with `null` / `"PENDING"`, which on a replay would wipe the ticker or
 *   un-score a reviewed row — the standard outcome-review call omits both.
 * - `ruleVersionId` / `rulesVersion` are provenance: the ruleset the DECISION was made
 *   under. An outcome review must not re-attribute an old decision to whatever ruleset is
 *   running today. Only a replay that changes the decision itself (ticker or
 *   decisionType) re-stamps them.
 */
export function replayUpdateData(
  data: Prisma.DecisionReviewUncheckedCreateInput,
  input: { ticker?: string | null; reviewStatus?: string | null },
  decisionChanged: boolean,
): Prisma.DecisionReviewUncheckedUpdateInput {
  const {
    idempotencyKey: _key,
    branch: _branch,
    book: _book,
    ruleVersionId,
    rulesVersion,
    ...update
  } = data;
  const out: Prisma.DecisionReviewUncheckedUpdateInput = { ...update };
  if (input.ticker == null) delete out.ticker;
  if (input.reviewStatus == null) delete out.reviewStatus;
  if (decisionChanged) {
    out.ruleVersionId = ruleVersionId;
    out.rulesVersion = rulesVersion;
  }
  return out;
}
