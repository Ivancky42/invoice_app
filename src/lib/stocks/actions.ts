"use server";

import { revalidatePath } from "next/cache";
import { runNotionSync, type SyncResult } from "@/lib/notion/sync";
import { runPricePushToNotion, type PricePushResult } from "@/lib/notion/pricePushToNotion";

/**
 * Trigger a Notion → Neon sync from the UI. Protected only by the site PIN
 * gate (the action is only reachable to logged-in browsers); no SYNC_SECRET
 * is needed here because we are not exposing a public HTTP endpoint.
 */
export async function manualSyncNotion(): Promise<SyncResult> {
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

/** Finnhub → Notion (**Current Price**; portfolio also **Last Price Update**). Does not touch Neon. */
export async function manualPushPricesToNotion(): Promise<PricePushResult> {
  return runPricePushToNotion();
}
