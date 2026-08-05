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
  normalizePositionAction,
  normalizeRiskLevel,
  normalizeSleeve,
  normalizeTheme,
} from "@/lib/stocks/normalizeStatus";

function mapPage(page: PageObjectResponse): Prisma.PortfolioUncheckedCreateInput | null {
  const ticker = asString(readProp(page, "Stock"));
  if (!ticker) return null;

  const actionRaw = asString(readProp(page, "Action"));
  const riskLevelRaw = asString(readProp(page, "Risk Level"));
  const analystRatingRaw = asString(readProp(page, "Analyst Rating"));
  const marketCapBucketRaw = asString(readProp(page, "Market Cap Bucket"));
  const sleeveRaw = asString(readProp(page, "Sleeve"));
  const sectorTagRaw = asString(readProp(page, "Sector Tag"));

  return {
    notionId: page.id,
    ticker,
    company: asString(readProp(page, "Company")),
    shares: asNumber(readProp(page, "Shares")) ?? null,
    currentPrice: asNumber(readProp(page, "Current Price")) ?? null,
    myAvgCost: asNumber(readProp(page, "My Avg Cost")) ?? null,
    analystTarget: asNumber(readProp(page, "Analyst Target")) ?? null,
    upsidePct: asNumber(readProp(page, "Upside to Target %")) ?? null,
    actionRaw,
    action: normalizePositionAction(actionRaw),
    riskLevelRaw,
    riskLevel: normalizeRiskLevel(riskLevelRaw),
    analystRatingRaw,
    analystRating: normalizeAnalystRating(analystRatingRaw),
    socialScore: asInt(readProp(page, "Social Score")),
    socialSentiment: asString(readProp(page, "Social Sentiment")),
    earningsDate: asDate(readProp(page, "Earnings Date")),
    daysToEarnings: asInt(readProp(page, "Days to Earnings")),
    stopLoss: asNumber(readProp(page, "Stop Loss")) ?? null,
    entryZone: asString(readProp(page, "Entry Zone")),
    thesis: toJsonBlocks(asString(readProp(page, "Thesis"))),
    sectorTagRaw,
    theme: normalizeTheme(sectorTagRaw),
    marketCapBucketRaw,
    marketCapBucket: normalizeMarketCapBucket(marketCapBucketRaw),
    sleeve: normalizeSleeve(sleeveRaw),
    conviction: asInt(readProp(page, "Conviction (1-5)")),
    addsUsed: asInt(readProp(page, "Adds Used")),
    notes: toJsonBlocks(asString(readProp(page, "Notes"))),
    keyRisk: asString(readProp(page, "Key Risk")),
    beatRate: asString(readProp(page, "Beat Rate")),
    impliedMove: asString(readProp(page, "Implied Earnings Move")),
    lastPriceUpdate: asDate(readProp(page, "Last Price Update")),
  };
}

export async function syncPortfolio(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_PORTFOLIO_DB");
  const pages = await queryAllPages(dbId);
  const rows: Prisma.PortfolioUncheckedCreateInput[] = [];
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
      if (!notionId) throw new Error("Portfolio sync row missing notionId");
      return prisma.portfolio.upsert({
        where: { notionId },
        create: r,
        update,
      });
    }),
  );
  if (ids.length > 0) {
    // Only prune Notion-synced rows; agent-created rows (notionId null) are kept.
    await prisma.portfolio.deleteMany({
      where: { notionId: { not: null, notIn: ids } },
    });
  }
  return { count: rows.length };
}
