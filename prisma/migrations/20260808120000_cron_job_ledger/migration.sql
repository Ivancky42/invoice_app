-- Cron dispatcher job ledger: one row per (job, UTC run day).
-- The reserved `__tick` job row doubles as the dispatcher lease (leaseUntil).

DO $$ BEGIN
  CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "JobRun" (
  "id" TEXT NOT NULL,
  "job" TEXT NOT NULL,
  "runDay" DATE NOT NULL,
  "status" "JobStatus" NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "cursor" JSONB,
  "error" TEXT,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "JobRun_job_runDay_key" ON "JobRun"("job", "runDay");
CREATE INDEX IF NOT EXISTS "JobRun_runDay_idx" ON "JobRun"("runDay");
