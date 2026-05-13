import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asDate, asInt, asNumber, asString, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { queryAllPages } from "@/lib/notion/queryAll";

function mapPage(page: PageObjectResponse): Prisma.PortfolioUncheckedCreateInput | null {
  const ticker = asString(readProp(page, "Stock"));
  if (!ticker) return null;

  return {
    notionId: page.id,
    ticker,
    company: asString(readProp(page, "Company")),
    currentPrice: asNumber(readProp(page, "Current Price")) ?? null,
    myAvgCost: asNumber(readProp(page, "My Avg Cost")) ?? null,
    analystTarget: asNumber(readProp(page, "Analyst Target")) ?? null,
    upsidePct: asNumber(readProp(page, "Upside to Target %")) ?? null,
    action: asString(readProp(page, "Action")),
    riskLevel: asString(readProp(page, "Risk Level")),
    analystRating: asString(readProp(page, "Analyst Rating")),
    socialScore: asInt(readProp(page, "Social Score")),
    socialSentiment: asString(readProp(page, "Social Sentiment")),
    earningsDate: asDate(readProp(page, "Earnings Date")),
    daysToEarnings: asInt(readProp(page, "Days to Earnings")),
    stopLoss: asNumber(readProp(page, "Stop Loss")) ?? null,
    entryZone: asString(readProp(page, "Entry Zone")),
    thesis: asString(readProp(page, "Thesis")),
    sectorTag: asString(readProp(page, "Sector Tag")),
    marketCapBucket: asString(readProp(page, "Market Cap Bucket")),
    notes: asString(readProp(page, "Notes")),
    keyRisk: asString(readProp(page, "Key Risk")),
    beatRate: asString(readProp(page, "Beat Rate")),
    impliedMove: asString(readProp(page, "Implied Earnings Move")),
    lastPriceUpdate: asDate(readProp(page, "Last Price Update")),
  };
}

export async function syncPortfolio(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_PORTFOLIO_DB");
  const pages = await queryAllPages(dbId);
  const rows = pages.map(mapPage).filter((r): r is Prisma.PortfolioUncheckedCreateInput => r !== null);
  const ids = rows.map((r) => r.notionId);
  await prisma.$transaction(
    rows.map((r) => {
      const { notionId, ...update } = r;
      return prisma.portfolio.upsert({
        where: { notionId },
        create: r,
        update,
      });
    }),
  );
  if (ids.length > 0) {
    await prisma.portfolio.deleteMany({ where: { notionId: { notIn: ids } } });
  }
  return { count: rows.length };
}
