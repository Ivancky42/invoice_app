-- Phase 0a: status enums + *Raw retention. Preserve existing string values into *Raw.

CREATE TYPE "PositionAction" AS ENUM ('HOLD', 'ADD_ON_DIP', 'REDUCE', 'EXIT', 'WATCH');
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'LOW_MEDIUM', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH', 'VERY_HIGH');
CREATE TYPE "WatchlistPriority" AS ENUM ('BUY_NOW', 'WAIT_FOR_ENTRY', 'WATCH', 'SKIP_FOR_NOW');
CREATE TYPE "AnalystRating" AS ENUM ('STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'NO_COVERAGE');
CREATE TYPE "MarketCapBucket" AS ENUM ('MEGA', 'LARGE', 'MID', 'SMALL');
CREATE TYPE "Sleeve" AS ENUM ('QUALITY_CORE', 'MOMENTUM_CATALYST', 'SPECULATIVE');
CREATE TYPE "TrendStage" AS ENUM ('EMERGING', 'BUILDING', 'HOT', 'PEAKED', 'FADED', 'PAUSED');
CREATE TYPE "TrendVerdict" AS ENUM ('WIN', 'LOSS', 'ONGOING', 'TOO_EARLY');
CREATE TYPE "WeekMomentum" AS ENUM ('ACCELERATING', 'STABLE', 'DECELERATING', 'REVERSED');
CREATE TYPE "DiscoveredVia" AS ENUM ('DAILY_SCAN', 'WEEKLY_SCAN', 'MONTHLY_SURVEY', 'MANUAL');
CREATE TYPE "TradeType" AS ENUM ('BUY', 'ADD', 'TRIM', 'SELL', 'STOP_LOSS');
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'PARTIAL', 'CLOSED');
CREATE TYPE "IdeaStatus" AS ENUM ('RESEARCHING', 'READY_FOR_WATCHLIST', 'HOLD_OFF', 'PASS', 'GRADUATED');

-- Portfolio: rename string cols → *Raw, add enum cols + sleeve/conviction/addsUsed
ALTER TABLE "Portfolio" RENAME COLUMN "action" TO "actionRaw";
ALTER TABLE "Portfolio" RENAME COLUMN "riskLevel" TO "riskLevelRaw";
ALTER TABLE "Portfolio" RENAME COLUMN "analystRating" TO "analystRatingRaw";
ALTER TABLE "Portfolio" RENAME COLUMN "marketCapBucket" TO "marketCapBucketRaw";
ALTER TABLE "Portfolio" ADD COLUMN "action" "PositionAction";
ALTER TABLE "Portfolio" ADD COLUMN "riskLevel" "RiskLevel";
ALTER TABLE "Portfolio" ADD COLUMN "analystRating" "AnalystRating";
ALTER TABLE "Portfolio" ADD COLUMN "marketCapBucket" "MarketCapBucket";
ALTER TABLE "Portfolio" ADD COLUMN "sleeve" "Sleeve";
ALTER TABLE "Portfolio" ADD COLUMN "conviction" INTEGER;
ALTER TABLE "Portfolio" ADD COLUMN "addsUsed" INTEGER;

-- Watchlist: drop old priority index (follows renamed column), then recreate on enum
DROP INDEX IF EXISTS "Watchlist_priority_idx";
ALTER TABLE "Watchlist" RENAME COLUMN "priority" TO "priorityRaw";
ALTER TABLE "Watchlist" RENAME COLUMN "riskLevel" TO "riskLevelRaw";
ALTER TABLE "Watchlist" RENAME COLUMN "analystRating" TO "analystRatingRaw";
ALTER TABLE "Watchlist" RENAME COLUMN "marketCapBucket" TO "marketCapBucketRaw";
ALTER TABLE "Watchlist" ADD COLUMN "priority" "WatchlistPriority";
ALTER TABLE "Watchlist" ADD COLUMN "riskLevel" "RiskLevel";
ALTER TABLE "Watchlist" ADD COLUMN "analystRating" "AnalystRating";
ALTER TABLE "Watchlist" ADD COLUMN "marketCapBucket" "MarketCapBucket";
CREATE INDEX "Watchlist_priority_idx" ON "Watchlist"("priority");

-- Trade
DROP INDEX IF EXISTS "Trade_status_idx";
ALTER TABLE "Trade" RENAME COLUMN "type" TO "typeRaw";
ALTER TABLE "Trade" RENAME COLUMN "status" TO "statusRaw";
ALTER TABLE "Trade" ADD COLUMN "type" "TradeType";
ALTER TABLE "Trade" ADD COLUMN "status" "TradeStatus";
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- Trend
DROP INDEX IF EXISTS "Trend_lifecycleStage_idx";
ALTER TABLE "Trend" RENAME COLUMN "lifecycleStage" TO "lifecycleStageRaw";
ALTER TABLE "Trend" RENAME COLUMN "discoveredVia" TO "discoveredViaRaw";
ALTER TABLE "Trend" RENAME COLUMN "weekMomentum" TO "weekMomentumRaw";
ALTER TABLE "Trend" RENAME COLUMN "verdict" TO "verdictRaw";
ALTER TABLE "Trend" ADD COLUMN "lifecycleStage" "TrendStage";
ALTER TABLE "Trend" ADD COLUMN "discoveredVia" "DiscoveredVia";
ALTER TABLE "Trend" ADD COLUMN "weekMomentum" "WeekMomentum";
ALTER TABLE "Trend" ADD COLUMN "verdict" "TrendVerdict";
CREATE INDEX "Trend_lifecycleStage_idx" ON "Trend"("lifecycleStage");

-- Idea
DROP INDEX IF EXISTS "Idea_status_idx";
ALTER TABLE "Idea" RENAME COLUMN "status" TO "statusRaw";
ALTER TABLE "Idea" ADD COLUMN "status" "IdeaStatus";
CREATE INDEX "Idea_status_idx" ON "Idea"("status");
