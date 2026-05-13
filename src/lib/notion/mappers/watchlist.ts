import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asDate, asInt, asNumber, asString, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { queryAllPages } from "@/lib/notion/queryAll";

function mapPage(page: PageObjectResponse): Prisma.WatchlistUncheckedCreateInput | null {
  const ticker = asString(readProp(page, "Stock"));
  if (!ticker) return null;

  return {
    notionId: page.id,
    ticker,
    company: asString(readProp(page, "Company")),
    theme: asString(readProp(page, "Theme")),
    sector: asString(readProp(page, "Sector")),
    priority: asString(readProp(page, "Priority")),
    currentPrice: asNumber(readProp(page, "Current Price")) ?? null,
    analystTarget: asNumber(readProp(page, "Analyst Target")) ?? null,
    bullTarget: asNumber(readProp(page, "Bull Target")) ?? null,
    upsidePct: asNumber(readProp(page, "Upside %")) ?? null,
    riskLevel: asString(readProp(page, "Risk Level")),
    analystRating: asString(readProp(page, "Analyst Rating")),
    socialScore: asInt(readProp(page, "Social Score")),
    socialPlatformBuzz: asString(readProp(page, "Social Platform Buzz")),
    earningsDate: asDate(readProp(page, "Earnings Date")),
    daysToEarnings: asInt(readProp(page, "Days to Earnings")),
    earningsRisk: asString(readProp(page, "Earnings Risk")),
    entryZone: asString(readProp(page, "Entry Zone")),
    stopLoss: asNumber(readProp(page, "Stop Loss")) ?? null,
    keyCatalyst: asString(readProp(page, "Key Catalyst")),
    keyRisk: asString(readProp(page, "Key Risk")),
    thesis: asString(readProp(page, "Thesis")),
    actionNotes: asString(readProp(page, "Action Notes")),
    beatRate: asString(readProp(page, "Beat Rate")),
    impliedMove: asString(readProp(page, "Implied Move")),
    analystCount: asInt(readProp(page, "# Analysts")),
    marketCapBucket: asString(readProp(page, "Market Cap Bucket")),
  };
}

export async function syncWatchlist(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_WATCHLIST_DB");
  const pages = await queryAllPages(dbId);
  const rows = pages.map(mapPage).filter((r): r is Prisma.WatchlistUncheckedCreateInput => r !== null);
  const ids = rows.map((r) => r.notionId);
  await prisma.$transaction(
    rows.map((r) => {
      const { notionId, ...update } = r;
      return prisma.watchlist.upsert({
        where: { notionId },
        create: r,
        update,
      });
    }),
  );
  if (ids.length > 0) {
    await prisma.watchlist.deleteMany({ where: { notionId: { notIn: ids } } });
  }
  return { count: rows.length };
}
