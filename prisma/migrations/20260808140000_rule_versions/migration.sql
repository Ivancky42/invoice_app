-- Versioned, database-resident ruleset + branch tagging for shadow evolution.
-- Hand-written and idempotent (safe to re-run against a partially migrated DB).

DO $$ BEGIN
  CREATE TYPE "RuleStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'RETIRED', 'KILLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RuleLane" AS ENUM ('FAST', 'SLOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RuleActor" AS ENUM ('AGENT', 'HUMAN', 'CRON');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "Branch" AS ENUM ('LIVE', 'CANDIDATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RuleVersion" (
  "id" SERIAL NOT NULL,
  "status" "RuleStatus" NOT NULL,
  "lane" "RuleLane",
  "actor" "RuleActor" NOT NULL,
  "parentId" INTEGER,
  "files" JSONB NOT NULL,
  "fileShas" JSONB NOT NULL,
  "limits" JSONB NOT NULL,
  "changeSummary" TEXT,
  "changedPaths" JSONB,
  "evidenceCutoff" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RuleVersion_status_idx" ON "RuleVersion"("status");

-- Branch / ruleVersion tagging on routine outputs.
ALTER TABLE "DecisionReview" ADD COLUMN IF NOT EXISTS "branch" "Branch" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "DecisionReview" ADD COLUMN IF NOT EXISTS "ruleVersionId" INTEGER;
CREATE INDEX IF NOT EXISTS "DecisionReview_branch_idx" ON "DecisionReview"("branch");

ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "branch" "Branch" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "ruleVersionId" INTEGER;

ALTER TABLE "StockReport" ADD COLUMN IF NOT EXISTS "branch" "Branch" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "StockReport" ADD COLUMN IF NOT EXISTS "ruleVersionId" INTEGER;

-- The real book is LIVE-only: Trade gets the version stamp but no branch column.
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "ruleVersionId" INTEGER;

-- Widen the natural keys with branch (existing rows are all LIVE, so no collisions).
DROP INDEX IF EXISTS "DailyLog_logDate_routineType_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DailyLog_logDate_routineType_branch_key"
  ON "DailyLog"("logDate", "routineType", "branch");

DROP INDEX IF EXISTS "StockReport_reportType_reportDate_key";
CREATE UNIQUE INDEX IF NOT EXISTS "StockReport_reportType_reportDate_branch_key"
  ON "StockReport"("reportType", "reportDate", "branch");

-- Partial unique indexes Prisma's schema language cannot express.
-- At most one CANDIDATE per lane, and at most one ACTIVE version overall.
-- Lane is nullable (human candidates belong to no lane) and SQL NULLs are distinct, so a
-- bare index on ("lane") would not constrain null-lane rows at all. Map null onto a real
-- key instead. `COALESCE("lane"::text, 'NONE')` is rejected — the enum→text cast is only
-- STABLE — hence the enumerated CASE, which is IMMUTABLE. Extend it if RuleLane grows.
DO $$ BEGIN
  DROP INDEX IF EXISTS "RuleVersion_one_candidate_per_lane";
  CREATE UNIQUE INDEX "RuleVersion_one_candidate_per_lane" ON "RuleVersion"
    ((CASE WHEN "lane" IS NULL THEN 'NONE' WHEN "lane" = 'FAST' THEN 'FAST' ELSE 'SLOW' END))
    WHERE "status" = 'CANDIDATE';
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "RuleVersion_one_active" ON "RuleVersion"((1)) WHERE "status" = 'ACTIVE';
