-- Phase 2: cuid PKs (notionId → nullable unique), natural uniques, Portfolio.shares, Idea funnel fields.
-- Fail loudly on duplicate natural keys before adding unique constraints.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "IdeaStage" AS ENUM ('RADAR', 'PRE_BUZZ', 'EMERGING', 'INSTITUTIONALIZING', 'MAINSTREAM');

-- ---------------------------------------------------------------------------
-- Duplicate natural-key guards (raise with clear message)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dup text;
BEGIN
  SELECT string_agg(ticker || '×' || cnt::text, ', ' ORDER BY ticker)
  INTO dup
  FROM (SELECT ticker, COUNT(*)::int AS cnt FROM "Portfolio" GROUP BY ticker HAVING COUNT(*) > 1) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Portfolio duplicate tickers block unique(ticker): %', dup;
  END IF;

  SELECT string_agg(ticker || '×' || cnt::text, ', ' ORDER BY ticker)
  INTO dup
  FROM (SELECT ticker, COUNT(*)::int AS cnt FROM "Watchlist" GROUP BY ticker HAVING COUNT(*) > 1) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Watchlist duplicate tickers block unique(ticker): %', dup;
  END IF;

  SELECT string_agg("trendName" || '×' || cnt::text, ', ' ORDER BY "trendName")
  INTO dup
  FROM (SELECT "trendName", COUNT(*)::int AS cnt FROM "Trend" GROUP BY "trendName" HAVING COUNT(*) > 1) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Trend duplicate trendName block unique(trendName): %', dup;
  END IF;

  SELECT string_agg("stockSector" || '×' || cnt::text, ', ' ORDER BY "stockSector")
  INTO dup
  FROM (SELECT "stockSector", COUNT(*)::int AS cnt FROM "Idea" GROUP BY "stockSector" HAVING COUNT(*) > 1) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Idea duplicate stockSector block unique(stockSector): %', dup;
  END IF;

  SELECT string_agg(COALESCE("logDate"::text, 'NULL') || '×' || cnt::text, ', ')
  INTO dup
  FROM (
    SELECT "logDate", COUNT(*)::int AS cnt
    FROM "DailyLog"
    WHERE "logDate" IS NOT NULL
    GROUP BY "logDate"
    HAVING COUNT(*) > 1
  ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'DailyLog duplicate logDate block unique(logDate): %', dup;
  END IF;

  SELECT string_agg("reportType"::text || '/' || COALESCE("reportDate"::text, 'NULL') || '×' || cnt::text, ', ')
  INTO dup
  FROM (
    SELECT "reportType", "reportDate", COUNT(*)::int AS cnt
    FROM "StockReport"
    GROUP BY "reportType", "reportDate"
    HAVING COUNT(*) > 1
  ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'StockReport duplicate (reportType, reportDate) block unique: %', dup;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helper: backfill id with cuid-like text ('c' + 24 hex from uuid)
-- ---------------------------------------------------------------------------
-- Existing rows get stable random ids; new rows use Prisma @default(cuid()).

-- Portfolio
ALTER TABLE "Portfolio" ADD COLUMN "id" TEXT;
UPDATE "Portfolio" SET "id" = 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) WHERE "id" IS NULL;
ALTER TABLE "Portfolio" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Portfolio" DROP CONSTRAINT "Portfolio_pkey";
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id");
ALTER TABLE "Portfolio" ALTER COLUMN "notionId" DROP NOT NULL;
CREATE UNIQUE INDEX "Portfolio_notionId_key" ON "Portfolio"("notionId");
DROP INDEX IF EXISTS "Portfolio_ticker_idx";
CREATE UNIQUE INDEX "Portfolio_ticker_key" ON "Portfolio"("ticker");
ALTER TABLE "Portfolio" ADD COLUMN "shares" DECIMAL(18,4);

-- Watchlist
ALTER TABLE "Watchlist" ADD COLUMN "id" TEXT;
UPDATE "Watchlist" SET "id" = 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) WHERE "id" IS NULL;
ALTER TABLE "Watchlist" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Watchlist" DROP CONSTRAINT "Watchlist_pkey";
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id");
ALTER TABLE "Watchlist" ALTER COLUMN "notionId" DROP NOT NULL;
CREATE UNIQUE INDEX "Watchlist_notionId_key" ON "Watchlist"("notionId");
DROP INDEX IF EXISTS "Watchlist_ticker_idx";
CREATE UNIQUE INDEX "Watchlist_ticker_key" ON "Watchlist"("ticker");

-- Trade
ALTER TABLE "Trade" ADD COLUMN "id" TEXT;
UPDATE "Trade" SET "id" = 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) WHERE "id" IS NULL;
ALTER TABLE "Trade" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Trade" DROP CONSTRAINT "Trade_pkey";
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_pkey" PRIMARY KEY ("id");
ALTER TABLE "Trade" ALTER COLUMN "notionId" DROP NOT NULL;
CREATE UNIQUE INDEX "Trade_notionId_key" ON "Trade"("notionId");
ALTER TABLE "Trade" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Trade_idempotencyKey_key" ON "Trade"("idempotencyKey");

-- Trend
ALTER TABLE "Trend" ADD COLUMN "id" TEXT;
UPDATE "Trend" SET "id" = 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) WHERE "id" IS NULL;
ALTER TABLE "Trend" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Trend" DROP CONSTRAINT "Trend_pkey";
ALTER TABLE "Trend" ADD CONSTRAINT "Trend_pkey" PRIMARY KEY ("id");
ALTER TABLE "Trend" ALTER COLUMN "notionId" DROP NOT NULL;
CREATE UNIQUE INDEX "Trend_notionId_key" ON "Trend"("notionId");
CREATE UNIQUE INDEX "Trend_trendName_key" ON "Trend"("trendName");

-- Idea
ALTER TABLE "Idea" ADD COLUMN "id" TEXT;
UPDATE "Idea" SET "id" = 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) WHERE "id" IS NULL;
ALTER TABLE "Idea" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Idea" DROP CONSTRAINT "Idea_pkey";
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_pkey" PRIMARY KEY ("id");
ALTER TABLE "Idea" ALTER COLUMN "notionId" DROP NOT NULL;
CREATE UNIQUE INDEX "Idea_notionId_key" ON "Idea"("notionId");
CREATE UNIQUE INDEX "Idea_stockSector_key" ON "Idea"("stockSector");
ALTER TABLE "Idea" ADD COLUMN "leadTicker" TEXT;
ALTER TABLE "Idea" ADD COLUMN "company" TEXT;
ALTER TABLE "Idea" ADD COLUMN "ideaStage" "IdeaStage";
ALTER TABLE "Idea" ADD COLUMN "ideaStageRaw" TEXT;
ALTER TABLE "Idea" ADD COLUMN "keyRisk" TEXT;
ALTER TABLE "Idea" ADD COLUMN "notes" TEXT;
ALTER TABLE "Idea" ADD COLUMN "catalystDate" TIMESTAMP(3);
ALTER TABLE "Idea" ADD COLUMN "dateFound" TIMESTAMP(3);
ALTER TABLE "Idea" ADD COLUMN "lastReviewed" TIMESTAMP(3);
ALTER TABLE "Idea" ADD COLUMN "graduationDate" TIMESTAMP(3);
ALTER TABLE "Idea" ADD COLUMN "graduationPrice" DECIMAL(14,4);
CREATE INDEX "Idea_ideaStage_idx" ON "Idea"("ideaStage");

-- DailyLog
ALTER TABLE "DailyLog" ADD COLUMN "id" TEXT;
UPDATE "DailyLog" SET "id" = 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) WHERE "id" IS NULL;
ALTER TABLE "DailyLog" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "DailyLog" DROP CONSTRAINT "DailyLog_pkey";
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id");
ALTER TABLE "DailyLog" ALTER COLUMN "notionId" DROP NOT NULL;
CREATE UNIQUE INDEX "DailyLog_notionId_key" ON "DailyLog"("notionId");
DROP INDEX IF EXISTS "DailyLog_logDate_idx";
CREATE UNIQUE INDEX "DailyLog_logDate_key" ON "DailyLog"("logDate");

-- StockReport
ALTER TABLE "StockReport" ADD COLUMN "id" TEXT;
UPDATE "StockReport" SET "id" = 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) WHERE "id" IS NULL;
ALTER TABLE "StockReport" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "StockReport" DROP CONSTRAINT "StockReport_pkey";
ALTER TABLE "StockReport" ADD CONSTRAINT "StockReport_pkey" PRIMARY KEY ("id");
ALTER TABLE "StockReport" ALTER COLUMN "notionId" DROP NOT NULL;
CREATE UNIQUE INDEX "StockReport_notionId_key" ON "StockReport"("notionId");
CREATE UNIQUE INDEX "StockReport_reportType_reportDate_key" ON "StockReport"("reportType", "reportDate");
