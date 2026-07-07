-- CreateEnum
CREATE TYPE "CryptoAssetStatus" AS ENUM ('PORTFOLIO', 'WATCHLIST', 'TRENDING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CryptoBriefAction" AS ENUM ('BUY', 'SELL', 'HOLD', 'TRIM', 'ADD');

-- CreateEnum
CREATE TYPE "CryptoLearningKind" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "CryptoAsset" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coingeckoId" TEXT NOT NULL,
    "binanceSymbol" TEXT,
    "llamaSlug" TEXT,
    "status" "CryptoAssetStatus" NOT NULL DEFAULT 'WATCHLIST',
    "quantity" DECIMAL(24,10),
    "avgCost" DECIMAL(18,8),
    "thesis" TEXT,
    "notes" TEXT,
    "keyCatalyst" TEXT,
    "targetPrice" DECIMAL(18,8),
    "stopLoss" DECIMAL(18,8),
    "categories" JSONB,
    "trendingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CryptoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CryptoTrade" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "fee" DECIMAL(18,8),
    "tradedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CryptoTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CryptoMetricSnapshot" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(18,8),
    "marketCap" DECIMAL(24,2),
    "volume24h" DECIMAL(24,2),
    "change24hPct" DECIMAL(10,4),
    "change7dPct" DECIMAL(10,4),
    "athPrice" DECIMAL(18,8),
    "athDrawdownPct" DECIMAL(10,4),
    "circulatingPct" DECIMAL(8,4),
    "rsi14" DECIMAL(8,4),
    "ma20" DECIMAL(18,8),
    "ma50" DECIMAL(18,8),
    "maCross" TEXT,
    "volumeSpike" BOOLEAN NOT NULL DEFAULT false,
    "beta30dBtc" DECIMAL(8,4),
    "fundingRate" DECIMAL(12,8),
    "openInterest" DECIMAL(24,2),
    "tvl" DECIMAL(24,2),
    "tvlChange7dPct" DECIMAL(10,4),
    "flags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CryptoMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CryptoCatalyst" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "symbols" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CryptoCatalyst_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CryptoDailyBrief" (
    "id" TEXT NOT NULL,
    "briefDate" TIMESTAMP(3) NOT NULL,
    "marketSummary" TEXT NOT NULL,
    "fearGreed" INTEGER,
    "calls" JSONB NOT NULL,
    "watchlistNotes" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CryptoDailyBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CryptoLearningLog" (
    "id" TEXT NOT NULL,
    "kind" "CryptoLearningKind" NOT NULL,
    "logDate" TIMESTAMP(3) NOT NULL,
    "evaluations" JSONB,
    "heuristics" TEXT,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CryptoLearningLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CryptoAsset_symbol_key" ON "CryptoAsset"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoAsset_coingeckoId_key" ON "CryptoAsset"("coingeckoId");

-- CreateIndex
CREATE INDEX "CryptoAsset_status_idx" ON "CryptoAsset"("status");

-- CreateIndex
CREATE INDEX "CryptoTrade_assetId_tradedAt_idx" ON "CryptoTrade"("assetId", "tradedAt");

-- CreateIndex
CREATE INDEX "CryptoMetricSnapshot_snapshotDate_idx" ON "CryptoMetricSnapshot"("snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoMetricSnapshot_assetId_snapshotDate_key" ON "CryptoMetricSnapshot"("assetId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoCatalyst_url_key" ON "CryptoCatalyst"("url");

-- CreateIndex
CREATE INDEX "CryptoCatalyst_publishedAt_idx" ON "CryptoCatalyst"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoDailyBrief_briefDate_key" ON "CryptoDailyBrief"("briefDate");

-- CreateIndex
CREATE INDEX "CryptoLearningLog_kind_logDate_idx" ON "CryptoLearningLog"("kind", "logDate");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoLearningLog_kind_logDate_key" ON "CryptoLearningLog"("kind", "logDate");

-- AddForeignKey
ALTER TABLE "CryptoTrade" ADD CONSTRAINT "CryptoTrade_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CryptoAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CryptoMetricSnapshot" ADD CONSTRAINT "CryptoMetricSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CryptoAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

