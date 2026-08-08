-- Dual counterfactual horizons: interim (21) + full (63).
-- Unique key becomes (branchId, decisionReviewId, horizonSessions) so both can coexist.
-- Backfill a 21-session sibling for every existing row that lacks one.

DROP INDEX IF EXISTS "Counterfactual_branchId_decisionReviewId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Counterfactual_branchId_decisionReviewId_horizonSessions_key"
  ON "Counterfactual"("branchId", "decisionReviewId", "horizonSessions");

INSERT INTO "Counterfactual" (
  "id",
  "branchId",
  "decisionReviewId",
  "ticker",
  "decisionType",
  "decisionSession",
  "horizonSessions",
  "priceAtDecision",
  "permittedSize",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  'cf21_' || c."id",
  c."branchId",
  c."decisionReviewId",
  c."ticker",
  c."decisionType",
  c."decisionSession",
  21,
  c."priceAtDecision",
  c."permittedSize",
  'PENDING',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Counterfactual" c
WHERE c."horizonSessions" = 63
  AND NOT EXISTS (
    SELECT 1
    FROM "Counterfactual" s
    WHERE s."branchId" = c."branchId"
      AND s."decisionReviewId" = c."decisionReviewId"
      AND s."horizonSessions" = 21
  );
