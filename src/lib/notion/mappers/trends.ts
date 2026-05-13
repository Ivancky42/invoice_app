import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asDate, asInt, asNumber, asString, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { queryAllPages } from "@/lib/notion/queryAll";

function mapPage(page: PageObjectResponse): Prisma.TrendUncheckedCreateInput | null {
  const trendName = asString(readProp(page, "Trend Name"));
  if (!trendName) return null;

  return {
    notionId: page.id,
    trendName,
    dateDiscovered: asDate(readProp(page, "Date Discovered")),
    representativeTickers: asString(readProp(page, "Representative Tickers")),
    themeSector: asString(readProp(page, "Theme / Sector")),
    lifecycleStage: asString(readProp(page, "Lifecycle Stage")),
    signalScore: asInt(readProp(page, "Signal Score")),
    socialVelocity: asInt(readProp(page, "Social Velocity")),
    analystMomentum: asInt(readProp(page, "Analyst Momentum")),
    priceClustering: asInt(readProp(page, "Price Clustering")),
    fundamentalBacking: asInt(readProp(page, "Fundamental Backing")),
    discoveredVia: asString(readProp(page, "Discovered Via")),
    weekMomentum: asString(readProp(page, "Week Momentum")),
    perf1m: asNumber(readProp(page, "1M Performance %")) ?? null,
    perf3m: asNumber(readProp(page, "3M Performance %")) ?? null,
    verdict: asString(readProp(page, "Verdict")),
    similarToPastTrend: asString(readProp(page, "Similar To Past Trend")),
    keyCatalyst: asString(readProp(page, "Key Catalyst")),
    avoidReason: asString(readProp(page, "Avoid Reason")),
    notes: asString(readProp(page, "Notes")),
    retrospective: asString(readProp(page, "Retrospective")),
  };
}

export async function syncTrends(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_TRENDS_DB");
  const pages = await queryAllPages(dbId);
  const rows = pages.map(mapPage).filter((r): r is Prisma.TrendUncheckedCreateInput => r !== null);
  await prisma.$transaction(
    rows.map((r) =>
      prisma.trend.upsert({ where: { notionId: r.notionId }, create: r, update: r }),
    ),
  );
  return { count: rows.length };
}
