-- Phase 0b: Theme enum + *Raw retention for sector/theme strings.

CREATE TYPE "Theme" AS ENUM (
  'AI_INFRASTRUCTURE',
  'NUCLEAR_POWER',
  'HUMANOID_ROBOTS',
  'SPACE',
  'CRYPTO',
  'RETAIL_TECH',
  'HEALTHCARE',
  'FINTECH_PAYMENTS',
  'DEFENSE_DRONES',
  'MEME_SPECIAL_SIT'
);

-- Portfolio: sectorTag → sectorTagRaw, add theme
ALTER TABLE "Portfolio" RENAME COLUMN "sectorTag" TO "sectorTagRaw";
ALTER TABLE "Portfolio" ADD COLUMN "theme" "Theme";
CREATE INDEX "Portfolio_theme_idx" ON "Portfolio"("theme");

-- Watchlist: theme/sector strings → *Raw, add theme enum
ALTER TABLE "Watchlist" RENAME COLUMN "theme" TO "themeRaw";
ALTER TABLE "Watchlist" RENAME COLUMN "sector" TO "sectorRaw";
ALTER TABLE "Watchlist" ADD COLUMN "theme" "Theme";
CREATE INDEX "Watchlist_theme_idx" ON "Watchlist"("theme");

-- Trend: themeSector → themeSectorRaw, add theme
ALTER TABLE "Trend" RENAME COLUMN "themeSector" TO "themeSectorRaw";
ALTER TABLE "Trend" ADD COLUMN "theme" "Theme";
CREATE INDEX "Trend_theme_idx" ON "Trend"("theme");

-- Idea: theme string → themeRaw, add theme enum
ALTER TABLE "Idea" RENAME COLUMN "theme" TO "themeRaw";
ALTER TABLE "Idea" ADD COLUMN "theme" "Theme";
CREATE INDEX "Idea_theme_idx" ON "Idea"("theme");
