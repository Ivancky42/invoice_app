-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "totalValue" DECIMAL(18,4) NOT NULL,
    "equitiesValue" DECIMAL(18,4),
    "cashValue" DECIMAL(18,4),
    "unrealizedPnl" DECIMAL(18,4),
    "dailyReturnPct" DECIMAL(10,4),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("snapshotDate")
);

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_snapshotDate_idx" ON "PortfolioSnapshot"("snapshotDate");
