-- Evidence tiers (Commit 8): EvidenceItem rows cited on a DecisionReview.
-- Hand-written and idempotent (safe to re-run against a partially migrated DB).

DO $$ BEGIN
  CREATE TYPE "EvidenceTier" AS ENUM ('T1', 'T2', 'T3', 'T4');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EvidenceKind" AS ENUM (
    'FILING',
    'EARNINGS_CALL',
    'MANAGEMENT_GUIDANCE',
    'PRIMARY_DATA',
    'NEWS_REPORT',
    'ANALYST_NOTE',
    'SOCIAL_SENTIMENT',
    'PRICE_ACTION',
    'INFERENCE',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EvidenceItem" (
  "id"               TEXT NOT NULL,
  "decisionReviewId" TEXT NOT NULL,
  "tier"             "EvidenceTier" NOT NULL,
  "kind"             "EvidenceKind" NOT NULL,
  "summary"          TEXT NOT NULL,
  "sourceUrl"        TEXT,
  "observedAt"       TIMESTAMP(3) NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EvidenceItem_decisionReviewId_idx" ON "EvidenceItem"("decisionReviewId");
