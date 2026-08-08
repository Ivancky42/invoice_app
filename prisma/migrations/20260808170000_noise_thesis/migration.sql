-- Noise-classification inputs + thesis-state columns on DecisionReview.
-- Every fraction column is a FRACTION (0.03 = 3%), never percentage points.
-- Hand-written and idempotent (safe to re-run against a partially migrated DB).

DO $$ BEGIN
  CREATE TYPE "MoveClass" AS ENUM ('MARKET_MOVE', 'THEME_MOVE', 'IDIOSYNCRATIC', 'INSUFFICIENT_DATA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ThesisState" AS ENUM ('INTACT', 'WEAKENING', 'BROKEN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "DecisionReview" ADD COLUMN IF NOT EXISTS "thesisState" "ThesisState";
ALTER TABLE "DecisionReview" ADD COLUMN IF NOT EXISTS "priorThesisState" "ThesisState";
ALTER TABLE "DecisionReview" ADD COLUMN IF NOT EXISTS "moveClass" "MoveClass";
-- Fraction of the tracked universe moving the same direction as the ticker.
ALTER TABLE "DecisionReview" ADD COLUMN IF NOT EXISTS "breadth" DECIMAL(6, 4);
-- Fraction of the ticker's theme moving the same direction.
ALTER TABLE "DecisionReview" ADD COLUMN IF NOT EXISTS "themeBreadth" DECIMAL(6, 4);
-- Ticker's 1-session return minus the market median return (signed fraction).
ALTER TABLE "DecisionReview" ADD COLUMN IF NOT EXISTS "excessMove" DECIMAL(10, 6);
