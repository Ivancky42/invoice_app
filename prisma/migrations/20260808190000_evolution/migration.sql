-- Evolution engine (Commit 9): append-only audit log + rule-version provenance columns.
-- Hand-written and idempotent (safe to re-run against a partially migrated DB).

DO $$ BEGIN
  CREATE TYPE "EvolutionEventKind" AS ENUM (
    'PROPOSE',
    'ELIGIBILITY_REJECT',
    'KERNEL_ATTEMPT',
    'GAPFIX',
    'PROMOTE',
    'EARLY_KILL',
    'HARD_REVERT',
    'INCONCLUSIVE',
    'DRIFT_BLOCK',
    'PATTERN_RETIRED',
    'SCORE',
    'MIRROR'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RuleOutcome" AS ENUM ('HELPED', 'NEUTRAL', 'HURT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ChangeDirection" AS ENUM ('TIGHTEN', 'LOOSEN', 'NEUTRAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RuleScope" AS ENUM ('DISCOVERY', 'ACTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Provenance a proposal must carry, plus the retrospective verdict. All additive and
-- nullable: every pre-existing RuleVersion row (including v1) stays valid.
ALTER TABLE "RuleVersion" ADD COLUMN IF NOT EXISTS "reasoningPattern" TEXT;
ALTER TABLE "RuleVersion" ADD COLUMN IF NOT EXISTS "successMetric" TEXT;
ALTER TABLE "RuleVersion" ADD COLUMN IF NOT EXISTS "counterCase" TEXT;
ALTER TABLE "RuleVersion" ADD COLUMN IF NOT EXISTS "direction" "ChangeDirection";
ALTER TABLE "RuleVersion" ADD COLUMN IF NOT EXISTS "scope" "RuleScope";
ALTER TABLE "RuleVersion" ADD COLUMN IF NOT EXISTS "outcome" "RuleOutcome";
ALTER TABLE "RuleVersion" ADD COLUMN IF NOT EXISTS "outcomeDetail" JSONB;

CREATE TABLE IF NOT EXISTS "EvolutionEvent" (
  "id"            TEXT NOT NULL,
  "kind"          "EvolutionEventKind" NOT NULL,
  "ruleVersionId" INTEGER,
  "actor"         "RuleActor" NOT NULL,
  "detail"        JSONB NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvolutionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EvolutionEvent_kind_idx" ON "EvolutionEvent"("kind");
CREATE INDEX IF NOT EXISTS "EvolutionEvent_ruleVersionId_idx" ON "EvolutionEvent"("ruleVersionId");

-- APPEND-ONLY, enforced by the database itself. DO INSTEAD NOTHING makes UPDATE and
-- DELETE silent no-ops for EVERY role, including the app's own connection — a compromised
-- agent, a stray migration, or a hand-run psql cannot rewrite the audit trail. The code
-- chokepoint (src/lib/evolution/log.ts) is defence in depth on top of this, not instead.
CREATE OR REPLACE RULE "EvolutionEvent_no_delete" AS ON DELETE TO "EvolutionEvent" DO INSTEAD NOTHING;
CREATE OR REPLACE RULE "EvolutionEvent_no_update" AS ON UPDATE TO "EvolutionEvent" DO INSTEAD NOTHING;
