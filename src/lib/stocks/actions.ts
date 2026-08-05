"use server";

import { revalidatePath } from "next/cache";
import { runNotionSync, type SyncResult } from "@/lib/notion/sync";
import { runPriceSyncToNeon, type PriceSyncResult } from "@/lib/stocks/priceSync";
import { recordPortfolioSnapshot } from "@/lib/stocks/recordPortfolioSnapshot";

const NOTION_SYNC_FROZEN_MSG =
  "notion sync frozen — set NOTION_SYNC_ENABLED=true to re-enable during go-back window";

/**
 * Trigger a Notion → Neon sync from the UI. Phase 5: inactive unless
 * NOTION_SYNC_ENABLED=true (emergency go-back window). Protected by the site
 * PIN gate; no SYNC_SECRET needed (not a public HTTP endpoint).
 */
export async function manualSyncNotion(): Promise<SyncResult> {
  if (process.env.NOTION_SYNC_ENABLED !== "true") {
    const now = new Date().toISOString();
    return {
      ok: false,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      results: {},
      errors: [NOTION_SYNC_FROZEN_MSG],
    };
  }
  const result = await runNotionSync();
  revalidatePath("/", "layout");
  revalidatePath("/stocks");
  revalidatePath("/stocks/portfolio");
  revalidatePath("/stocks/watchlist");
  revalidatePath("/stocks/trades");
  revalidatePath("/stocks/trends");
  revalidatePath("/stocks/ideas");
  revalidatePath("/stocks/daily-log");
  return result;
}

/**
 * Finnhub + EODHD (CSPX) → Neon Portfolio / Watchlist / Ideas, then portfolio
 * snapshot. Does not write prices to Notion.
 */
export async function manualSyncPrices(): Promise<PriceSyncResult> {
  const result = await runPriceSyncToNeon();
  if (result.ok) {
    try {
      await recordPortfolioSnapshot();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ...result,
        ok: false,
        errors: [...result.errors, `portfolioSnapshot: ${msg}`],
      };
    }
  }
  revalidatePath("/", "layout");
  revalidatePath("/stocks");
  revalidatePath("/stocks/portfolio");
  revalidatePath("/stocks/watchlist");
  revalidatePath("/stocks/ideas");
  return result;
}
