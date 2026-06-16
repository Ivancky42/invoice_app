-- Per-ticker daily notes synced from Notion page body (Portfolio Tracker / Watchlist).
ALTER TABLE "Portfolio" ADD COLUMN "pageNotes" TEXT;
ALTER TABLE "Watchlist" ADD COLUMN "pageNotes" TEXT;
