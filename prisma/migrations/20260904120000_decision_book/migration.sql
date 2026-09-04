-- DecisionReview.book: REAL (live advisory stream) vs PAPER (shadow ledger).
-- Additive. Existing CANDIDATE rows were always shadow-only and backfill to PAPER.
-- Hand-written and idempotent (safe to re-run against a partially migrated DB).

DO $$ BEGIN
  CREATE TYPE "DecisionBook" AS ENUM ('REAL', 'PAPER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "DecisionReview" ADD COLUMN IF NOT EXISTS "book" "DecisionBook" NOT NULL DEFAULT 'REAL';

CREATE INDEX IF NOT EXISTS "DecisionReview_branch_book_createdAt_idx"
  ON "DecisionReview"("branch", "book", "createdAt");

UPDATE "DecisionReview" SET "book"='PAPER' WHERE "branch"='CANDIDATE';
