-- Gap fill: Decision Review Log, ContentPage, WatchlistAction soft-demotion,
-- Portfolio Add Zone / Next Add Trigger.

CREATE TYPE "WatchlistAction" AS ENUM ('BUY_SUGGESTED', 'EARLY_ENTRY', 'DEMOTED', 'DROPPED');
CREATE TYPE "DecisionType" AS ENUM ('BUY', 'ADD', 'AVERAGE_DOWN', 'HOLD', 'REDUCE', 'EXIT', 'WAIT', 'AVOID', 'DO_NOT_AVERAGE_DOWN');
CREATE TYPE "DecisionReviewStatus" AS ENUM ('PENDING', 'REVIEWED_1W', 'REVIEWED_4W', 'REVIEWED_3M', 'CLOSED');
CREATE TYPE "DecisionVerdict" AS ENUM ('WIN', 'LOSS', 'AVOIDED_LOSS', 'TOO_EARLY', 'NEUTRAL');
CREATE TYPE "DecisionSignalQuality" AS ENUM ('GOOD', 'MIXED', 'POOR', 'TOO_EARLY');
CREATE TYPE "DecisionPositionContext" AS ENUM ('PORTFOLIO', 'WATCHLIST', 'NEW_IDEA', 'TREND', 'EARNINGS');
CREATE TYPE "ContentPageKey" AS ENUM ('STRATEGY_LESSONS', 'INVESTMENT_STYLE');

ALTER TABLE "Portfolio" ADD COLUMN "addZone" TEXT;
ALTER TABLE "Portfolio" ADD COLUMN "nextAddTrigger" TEXT;

ALTER TABLE "Watchlist" ADD COLUMN "action" "WatchlistAction";
ALTER TABLE "Watchlist" ADD COLUMN "actionRaw" TEXT;
ALTER TABLE "Watchlist" ADD COLUMN "demotedAt" TIMESTAMP(3);
CREATE INDEX "Watchlist_action_idx" ON "Watchlist"("action");

CREATE TABLE "DecisionReview" (
    "id" TEXT NOT NULL,
    "notionId" TEXT,
    "idempotencyKey" TEXT,
    "title" TEXT NOT NULL,
    "ticker" TEXT,
    "decisionDate" TIMESTAMP(3),
    "decisionType" "DecisionType",
    "decisionTypeRaw" TEXT,
    "positionContext" "DecisionPositionContext",
    "positionContextRaw" TEXT,
    "priceAtDecision" DECIMAL(14,4),
    "entryZone" TEXT,
    "stopLoss" DECIMAL(14,4),
    "target" DECIMAL(14,4),
    "convictionScore" INTEGER,
    "catalyst" TEXT,
    "catalystDate" TIMESTAMP(3),
    "originalThesis" TEXT,
    "expectedOutcome" TEXT,
    "keyMetricToWatch" TEXT,
    "reasonForDecision" TEXT,
    "riskInvalidation" TEXT,
    "sourceSignal" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "antiPatternTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criteriaThatWorked" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criteriaThatFailed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewStatus" "DecisionReviewStatus",
    "reviewStatusRaw" TEXT,
    "outcome1w" TEXT,
    "outcome4w" TEXT,
    "outcome3m" TEXT,
    "return1wPct" DECIMAL(8,4),
    "return4wPct" DECIMAL(8,4),
    "return3mPct" DECIMAL(8,4),
    "finalVerdict" "DecisionVerdict",
    "finalVerdictRaw" TEXT,
    "signalQuality" "DecisionSignalQuality",
    "signalQualityRaw" TEXT,
    "executionQuality" "DecisionSignalQuality",
    "executionQualityRaw" TEXT,
    "lessonLearned" TEXT,
    "updateStrategy" BOOLEAN,
    "rulesVersion" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DecisionReview_notionId_key" ON "DecisionReview"("notionId");
CREATE UNIQUE INDEX "DecisionReview_idempotencyKey_key" ON "DecisionReview"("idempotencyKey");
CREATE INDEX "DecisionReview_ticker_idx" ON "DecisionReview"("ticker");
CREATE INDEX "DecisionReview_decisionDate_idx" ON "DecisionReview"("decisionDate");
CREATE INDEX "DecisionReview_reviewStatus_idx" ON "DecisionReview"("reviewStatus");
CREATE INDEX "DecisionReview_decisionType_idx" ON "DecisionReview"("decisionType");

CREATE TABLE "ContentPage" (
    "key" "ContentPageKey" NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "notionPageId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPage_pkey" PRIMARY KEY ("key")
);
