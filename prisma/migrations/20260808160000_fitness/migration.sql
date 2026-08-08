-- Counterfactuals + fitness snapshots for shadow evolution.
-- Every fraction column is a FRACTION (0.03 = 3%), never percentage points.
-- Hand-written and idempotent (safe to re-run against a partially migrated DB).

DO $$ BEGIN
  CREATE TYPE "CounterfactualStatus" AS ENUM ('PENDING', 'RESOLVED', 'UNRESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SnapshotQuality" AS ENUM ('OK', 'DEGRADED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Counterfactual" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "decisionReviewId" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "decisionType" "DecisionType" NOT NULL,
  "decisionSession" DATE NOT NULL,
  -- Constant 63 sessions (one quarter), counted on the session calendar.
  "horizonSessions" INTEGER NOT NULL,
  "priceAtDecision" DECIMAL(14,4) NOT NULL,
  -- Fraction of NAV the branch's ruleset WOULD have allowed for this name.
  "permittedSize" DECIMAL(8,6) NOT NULL,
  "horizonSession" DATE,
  "priceAtHorizon" DECIMAL(14,4),
  "horizonReturn" DECIMAL(10,6),
  -- SIGNED credit: -horizonReturn * permittedSize. Never clamped.
  "credit" DECIMAL(10,6),
  "status" "CounterfactualStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Counterfactual_pkey" PRIMARY KEY ("id")
);

-- One counterfactual per decision per branch: a replayed seed must not double-count credit.
CREATE UNIQUE INDEX IF NOT EXISTS "Counterfactual_branchId_decisionReviewId_key"
  ON "Counterfactual"("branchId", "decisionReviewId");
-- listCounterfactuals queries by branchId (like ShadowOrder/ShadowPosition do), so the
-- branch scan gets its own narrow index rather than riding the wider unique above.
CREATE INDEX IF NOT EXISTS "Counterfactual_branchId_idx" ON "Counterfactual"("branchId");
CREATE INDEX IF NOT EXISTS "Counterfactual_status_idx" ON "Counterfactual"("status");

CREATE TABLE IF NOT EXISTS "FitnessSnapshot" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "session" DATE NOT NULL,
  "nav" DECIMAL(18,4) NOT NULL,
  "dailyIncrement" DECIMAL(10,6),
  "avoidedCreditDelta" DECIMAL(10,6) NOT NULL DEFAULT 0,
  "benchmarkIncrement" DECIMAL(10,6),
  "fitnessIncrement" DECIMAL(10,6),
  "windowFitness" DECIMAL(10,6),
  "maxDrawdown" DECIMAL(8,6) NOT NULL,
  "turnoverDelta" DECIMAL(10,6) NOT NULL DEFAULT 0,
  "quality" "SnapshotQuality" NOT NULL,
  "staleMarks" INTEGER NOT NULL,
  "openPositions" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FitnessSnapshot_pkey" PRIMARY KEY ("id")
);

-- One snapshot per branch per session — the nightly job upserts on this key.
CREATE UNIQUE INDEX IF NOT EXISTS "FitnessSnapshot_branchId_session_key"
  ON "FitnessSnapshot"("branchId", "session");
CREATE INDEX IF NOT EXISTS "FitnessSnapshot_session_idx" ON "FitnessSnapshot"("session");
