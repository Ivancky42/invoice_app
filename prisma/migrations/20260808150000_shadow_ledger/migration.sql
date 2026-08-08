-- Paper-only shadow ledger: two branches (LIVE / CANDIDATE) hold independent paper books
-- filled from DecisionReview rows at the next session's open and marked from PriceHistory.
-- Hand-written and idempotent (safe to re-run against a partially migrated DB).

DO $$ BEGIN
  CREATE TYPE "ShadowSide" AS ENUM ('BUY', 'SELL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ShadowOrderStatus" AS ENUM ('PENDING', 'FILLED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ShadowBranch" (
  "id" TEXT NOT NULL,
  "branch" "Branch" NOT NULL,
  "ruleVersionId" INTEGER NOT NULL,
  "startNav" DECIMAL(18,4) NOT NULL,
  "cash" DECIMAL(18,4) NOT NULL,
  "highWaterNav" DECIMAL(18,4) NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShadowBranch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShadowBranch_branch_key" ON "ShadowBranch"("branch");

CREATE TABLE IF NOT EXISTS "ShadowOrder" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "side" "ShadowSide" NOT NULL,
  "decisionType" "DecisionType",
  "decisionReviewId" TEXT,
  "decisionSession" DATE NOT NULL,
  "sizeFraction" DECIMAL(8,6) NOT NULL,
  "status" "ShadowOrderStatus" NOT NULL DEFAULT 'PENDING',
  "fillSession" DATE,
  "fillPrice" DECIMAL(14,4),
  "notional" DECIMAL(18,4),
  "shares" DECIMAL(18,6),
  "rejectReason" TEXT,
  "pendingSessions" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShadowOrder_pkey" PRIMARY KEY ("id")
);

-- One DecisionReview enqueues at most one order per side per branch (a replayed
-- routine must not double-size the paper book). Null decisionReviewId stays unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "ShadowOrder_branchId_decisionReviewId_side_key"
  ON "ShadowOrder"("branchId", "decisionReviewId", "side");
CREATE INDEX IF NOT EXISTS "ShadowOrder_branchId_status_idx" ON "ShadowOrder"("branchId", "status");
CREATE INDEX IF NOT EXISTS "ShadowOrder_decisionReviewId_idx" ON "ShadowOrder"("decisionReviewId");

CREATE TABLE IF NOT EXISTS "ShadowPosition" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "openedSession" DATE NOT NULL,
  "closedAt" TIMESTAMP(3),
  "shares" DECIMAL(18,6) NOT NULL,
  "avgCost" DECIMAL(14,4) NOT NULL,
  "lastMark" DECIMAL(14,4),
  "lastMarkSession" DATE,
  "markStale" BOOLEAN NOT NULL DEFAULT false,
  "realizedPnl" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShadowPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShadowPosition_branchId_idx" ON "ShadowPosition"("branchId");

-- Partial unique index Prisma's schema language cannot express: at most one OPEN
-- position per (branch, ticker). Closed rows are history and may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS "ShadowPosition_open_unique"
  ON "ShadowPosition"("branchId", "ticker") WHERE "closedAt" IS NULL;
