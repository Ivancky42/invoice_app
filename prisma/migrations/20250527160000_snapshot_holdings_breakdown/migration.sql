-- AlterTable
ALTER TABLE "PortfolioSnapshot" ADD COLUMN IF NOT EXISTS "holdingsBreakdown" JSONB;
