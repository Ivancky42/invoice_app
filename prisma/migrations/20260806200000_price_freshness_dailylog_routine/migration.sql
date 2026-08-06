-- Watchlist / Idea price freshness
ALTER TABLE "Watchlist" ADD COLUMN IF NOT EXISTS "lastPriceUpdate" TIMESTAMP(3);
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "lastPriceUpdate" TIMESTAMP(3);

-- DailyLog: separate Daily vs Earnings on the same calendar day
CREATE TYPE "DailyLogRoutine" AS ENUM ('DAILY', 'EARNINGS');

ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "routineType" "DailyLogRoutine" NOT NULL DEFAULT 'DAILY';

DROP INDEX IF EXISTS "DailyLog_logDate_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DailyLog_logDate_routineType_key" ON "DailyLog"("logDate", "routineType");
CREATE INDEX IF NOT EXISTS "DailyLog_logDate_idx" ON "DailyLog"("logDate");
