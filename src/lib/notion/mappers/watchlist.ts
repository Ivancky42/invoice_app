import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asDate, asInt, asNumber, asString, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { runInTransactionBatches } from "@/lib/notion/batchTransaction";
import { queryAllPages } from "@/lib/notion/queryAll";
import { fetchPageBlocks } from "@/lib/notion/blocks";
import { blocksToJsonValue, toJsonBlocks } from "@/lib/notion/jsonBlocks";
import {
  normalizeAnalystRating,
  normalizeMarketCapBucket,
  normalizeRiskLevel,
  normalizeTheme,
  normalizeWatchlistPriority,
} from "@/lib/stocks/normalizeStatus";

function mapPage(page: PageObjectResponse): Prisma.WatchlistUncheckedCreateInput | null {
  const ticker = asString(readProp(page, "Stock"));
  if (!ticker) return null;

  const priorityRaw = asString(readProp(page, "Priority"));
  const riskLevelRaw = asString(readProp(page, "Risk Level"));
  const analystRatingRaw = asString(readProp(page, "Analyst Rating"));
  const marketCapBucketRaw = asString(readProp(page, "Market Cap Bucket"));
  const themeRaw = asString(readProp(page, "Theme"));
  const sectorRaw = asString(readProp(page, "Sector"));

  return {
    notionId: page.id,
    ticker,
    company: asString(readProp(page, "Company")),
    themeRaw,
    sectorRaw,
    theme: normalizeTheme(themeRaw) ?? normalizeTheme(sectorRaw),
    priorityRaw,
    priority: normalizeWatchlistPriority(priorityRaw),
    currentPrice: asNumber(readProp(page, "Current Price")) ?? null,
    analystTarget: asNumber(readProp(page, "Analyst Target")) ?? null,
    bullTarget: asNumber(readProp(page, "Bull Target")) ?? null,
    upsidePct: asNumber(readProp(page, "Upside %")) ?? null,
    riskLevelRaw,
    riskLevel: normalizeRiskLevel(riskLevelRaw),
    analystRatingRaw,
    analystRating: normalizeAnalystRating(analystRatingRaw),
    socialScore: asInt(readProp(page, "Social Score")),
    socialPlatformBuzz: asString(readProp(page, "Social Platform Buzz")),
    earningsDate: asDate(readProp(page, "Earnings Date")),
    daysToEarnings: asInt(readProp(page, "Days to Earnings")),
    earningsRisk: asString(readProp(page, "Earnings Risk")),
    entryZone: asString(readProp(page, "Entry Zone")),
    stopLoss: asNumber(readProp(page, "Stop Loss")) ?? null,
    keyCatalyst: asString(readProp(page, "Key Catalyst")),
    keyRisk: asString(readProp(page, "Key Risk")),
    thesis: toJsonBlocks(asString(readProp(page, "Thesis"))),
    actionNotes: toJsonBlocks(asString(readProp(page, "Action Notes"))),
    beatRate: asString(readProp(page, "Beat Rate")),
    impliedMove: asString(readProp(page, "Implied Move")),
    analystCount: asInt(readProp(page, "# Analysts")),
    marketCapBucketRaw,
    marketCapBucket: normalizeMarketCapBucket(marketCapBucketRaw),
  };
}

export async function syncWatchlist(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_WATCHLIST_DB");
  const pages = await queryAllPages(dbId);
  const rows: Prisma.WatchlistUncheckedCreateInput[] = [];
  for (const page of pages) {
    const row = mapPage(page);
    if (!row) continue;
    const body = await fetchPageBlocks(page.id);
    rows.push({ ...row, pageNotes: blocksToJsonValue(body) });
  }
  const ids = rows.map((r) => r.notionId).filter((id): id is string => !!id);
  await runInTransactionBatches(
    rows.map((r) => {
      const { notionId, ...update } = r;
      if (!notionId) throw new Error("Watchlist sync row missing notionId");
      return prisma.watchlist.upsert({
        where: { notionId },
        create: r,
        update,
      });
    }),
  );
  if (ids.length > 0) {
    await prisma.watchlist.deleteMany({
      where: { notionId: { not: null, notIn: ids } },
    });
  }
  return { count: rows.length };
}
