-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."DocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."DocumentType" AS ENUM ('QUOTATION', 'INVOICE', 'DELIVERY_ORDER');

-- CreateTable
CREATE TABLE "public"."CompanyProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "registration" TEXT,
    "taxId" TEXT,
    "bankDetails" TEXT,
    "logoPath" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Document" (
    "id" TEXT NOT NULL,
    "type" "public"."DocumentType" NOT NULL,
    "number" TEXT NOT NULL,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "clientName" TEXT NOT NULL,
    "clientAddress" TEXT,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "items" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENT',
    "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "poNumber" TEXT,
    "projectDescription" TEXT,
    "projectTitle" TEXT,
    "shipToAddress" TEXT,
    "shipToAttn" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Idea" (
    "notionId" TEXT NOT NULL,
    "stockSector" TEXT NOT NULL,
    "theme" TEXT,
    "currentPrice" DECIMAL(14,4),
    "analystTarget" DECIMAL(14,4),
    "upsidePct" DECIMAL(8,4),
    "riskLevel" TEXT,
    "status" TEXT,
    "socialBuzz" TEXT,
    "foundVia" TEXT,
    "whyInteresting" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("notionId")
);

-- CreateTable
CREATE TABLE "public"."Portfolio" (
    "notionId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "company" TEXT,
    "currentPrice" DECIMAL(14,4),
    "myAvgCost" DECIMAL(14,4),
    "analystTarget" DECIMAL(14,4),
    "upsidePct" DECIMAL(8,4),
    "action" TEXT,
    "riskLevel" TEXT,
    "analystRating" TEXT,
    "socialScore" INTEGER,
    "socialSentiment" TEXT,
    "earningsDate" TIMESTAMP(3),
    "daysToEarnings" INTEGER,
    "stopLoss" DECIMAL(14,4),
    "entryZone" TEXT,
    "thesis" TEXT,
    "sectorTag" TEXT,
    "marketCapBucket" TEXT,
    "notes" TEXT,
    "keyRisk" TEXT,
    "beatRate" TEXT,
    "impliedMove" TEXT,
    "lastPriceUpdate" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("notionId")
);

-- CreateTable
CREATE TABLE "public"."SyncStatus" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "rowCounts" JSONB,

    CONSTRAINT "SyncStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Trade" (
    "notionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ticker" TEXT,
    "type" TEXT,
    "date" TIMESTAMP(3),
    "pricePerShare" DECIMAL(14,4),
    "shares" DECIMAL(18,4),
    "totalValue" DECIMAL(18,4),
    "pnlDollar" DECIMAL(18,4),
    "pnlPct" DECIMAL(8,4),
    "status" TEXT,
    "avgCostBasis" DECIMAL(14,4),
    "exitReason" TEXT,
    "thesisAtEntry" TEXT,
    "notes" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("notionId")
);

-- CreateTable
CREATE TABLE "public"."Trend" (
    "notionId" TEXT NOT NULL,
    "trendName" TEXT NOT NULL,
    "dateDiscovered" TIMESTAMP(3),
    "representativeTickers" TEXT,
    "themeSector" TEXT,
    "lifecycleStage" TEXT,
    "signalScore" INTEGER,
    "socialVelocity" INTEGER,
    "analystMomentum" INTEGER,
    "priceClustering" INTEGER,
    "fundamentalBacking" INTEGER,
    "discoveredVia" TEXT,
    "weekMomentum" TEXT,
    "perf1m" DECIMAL(8,4),
    "perf3m" DECIMAL(8,4),
    "verdict" TEXT,
    "similarToPastTrend" TEXT,
    "keyCatalyst" TEXT,
    "avoidReason" TEXT,
    "notes" TEXT,
    "retrospective" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trend_pkey" PRIMARY KEY ("notionId")
);

-- CreateTable
CREATE TABLE "public"."Watchlist" (
    "notionId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "company" TEXT,
    "theme" TEXT,
    "sector" TEXT,
    "priority" TEXT,
    "currentPrice" DECIMAL(14,4),
    "analystTarget" DECIMAL(14,4),
    "bullTarget" DECIMAL(14,4),
    "upsidePct" DECIMAL(8,4),
    "riskLevel" TEXT,
    "analystRating" TEXT,
    "socialScore" INTEGER,
    "socialPlatformBuzz" TEXT,
    "earningsDate" TIMESTAMP(3),
    "daysToEarnings" INTEGER,
    "earningsRisk" TEXT,
    "entryZone" TEXT,
    "stopLoss" DECIMAL(14,4),
    "keyCatalyst" TEXT,
    "keyRisk" TEXT,
    "thesis" TEXT,
    "actionNotes" TEXT,
    "beatRate" TEXT,
    "impliedMove" TEXT,
    "analystCount" INTEGER,
    "marketCapBucket" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("notionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_number_key" ON "public"."Document"("number" ASC);

-- CreateIndex
CREATE INDEX "Idea_status_idx" ON "public"."Idea"("status" ASC);

-- CreateIndex
CREATE INDEX "Portfolio_ticker_idx" ON "public"."Portfolio"("ticker" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SyncStatus_source_key" ON "public"."SyncStatus"("source" ASC);

-- CreateIndex
CREATE INDEX "Trade_date_idx" ON "public"."Trade"("date" ASC);

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "public"."Trade"("status" ASC);

-- CreateIndex
CREATE INDEX "Trade_ticker_idx" ON "public"."Trade"("ticker" ASC);

-- CreateIndex
CREATE INDEX "Trend_lifecycleStage_idx" ON "public"."Trend"("lifecycleStage" ASC);

-- CreateIndex
CREATE INDEX "Trend_signalScore_idx" ON "public"."Trend"("signalScore" ASC);

-- CreateIndex
CREATE INDEX "Watchlist_priority_idx" ON "public"."Watchlist"("priority" ASC);

-- CreateIndex
CREATE INDEX "Watchlist_ticker_idx" ON "public"."Watchlist"("ticker" ASC);

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
