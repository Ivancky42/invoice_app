-- Daily OHLC price history store + per-ticker sync health.

CREATE TABLE IF NOT EXISTS "PriceHistory" (
  "ticker" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "open" DECIMAL(14,4),
  "close" DECIMAL(14,4) NOT NULL,
  "adjClose" DECIMAL(14,4),
  "volume" BIGINT,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("ticker", "date")
);

CREATE INDEX IF NOT EXISTS "PriceHistory_date_idx" ON "PriceHistory"("date");

CREATE TABLE IF NOT EXISTS "TickerPriceStatus" (
  "ticker" TEXT NOT NULL,
  "lastSuccessAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastSource" TEXT,
  "lastError" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TickerPriceStatus_pkey" PRIMARY KEY ("ticker")
);
