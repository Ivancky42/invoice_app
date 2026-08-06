-- Persist agent rulesVersion on weekly/monthly reports (parity with DailyLog).
ALTER TABLE "StockReport" ADD COLUMN IF NOT EXISTS "rulesVersion" TEXT;
