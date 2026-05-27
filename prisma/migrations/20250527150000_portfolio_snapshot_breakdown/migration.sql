-- equitiesValue / cashValue are created in 20250527140000_portfolio_snapshot.
-- Idempotent for DBs that applied an older 400 migration without these columns.
ALTER TABLE "PortfolioSnapshot" ADD COLUMN IF NOT EXISTS "equitiesValue" DECIMAL(18,4);
ALTER TABLE "PortfolioSnapshot" ADD COLUMN IF NOT EXISTS "cashValue" DECIMAL(18,4);
