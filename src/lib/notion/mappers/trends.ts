import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asDate, asInt, asNumber, asString, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { runInTransactionBatches } from "@/lib/notion/batchTransaction";
import { queryAllPages } from "@/lib/notion/queryAll";
import { toJsonBlocks } from "@/lib/notion/jsonBlocks";
import {
  normalizeDiscoveredVia,
  normalizeTheme,
  normalizeTrendStage,
  normalizeTrendVerdict,
  normalizeWeekMomentum,
} from "@/lib/stocks/normalizeStatus";

function mapPage(page: PageObjectResponse): Prisma.TrendUncheckedCreateInput | null {
  const trendName = asString(readProp(page, "Trend Name"));
  if (!trendName) return null;

  const lifecycleStageRaw = asString(readProp(page, "Lifecycle Stage"));
  const discoveredViaRaw = asString(readProp(page, "Discovered Via"));
  const weekMomentumRaw = asString(readProp(page, "Week Momentum"));
  const verdictRaw = asString(readProp(page, "Verdict"));
  const themeSectorRaw = asString(readProp(page, "Theme / Sector"));

  return {
    notionId: page.id,
    trendName,
    dateDiscovered: asDate(readProp(page, "Date Discovered")),
    representativeTickers: asString(readProp(page, "Representative Tickers")),
    themeSectorRaw,
    theme: normalizeTheme(themeSectorRaw),
    lifecycleStageRaw,
    lifecycleStage: normalizeTrendStage(lifecycleStageRaw),
    signalScore: asInt(readProp(page, "Signal Score")),
    socialVelocity: asInt(readProp(page, "Social Velocity")),
    analystMomentum: asInt(readProp(page, "Analyst Momentum")),
    priceClustering: asInt(readProp(page, "Price Clustering")),
    fundamentalBacking: asInt(readProp(page, "Fundamental Backing")),
    discoveredViaRaw,
    discoveredVia: normalizeDiscoveredVia(discoveredViaRaw),
    weekMomentumRaw,
    weekMomentum: normalizeWeekMomentum(weekMomentumRaw),
    perf1m: asNumber(readProp(page, "1M Performance %")) ?? null,
    perf3m: asNumber(readProp(page, "3M Performance %")) ?? null,
    verdictRaw,
    verdict: normalizeTrendVerdict(verdictRaw),
    similarToPastTrend: asString(readProp(page, "Similar To Past Trend")),
    keyCatalyst: asString(readProp(page, "Key Catalyst")),
    avoidReason: toJsonBlocks(asString(readProp(page, "Avoid Reason"))),
    notes: toJsonBlocks(asString(readProp(page, "Notes"))),
    retrospective: toJsonBlocks(asString(readProp(page, "Retrospective"))),
  };
}

export async function syncTrends(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_TRENDS_DB");
  const pages = await queryAllPages(dbId);
  const rows = pages.map(mapPage).filter((r): r is Prisma.TrendUncheckedCreateInput => r !== null);
  await runInTransactionBatches(
    rows.map((r) => {
      const { notionId, ...update } = r;
      if (!notionId) throw new Error("Trend sync row missing notionId");
      return prisma.trend.upsert({ where: { notionId }, create: r, update });
    }),
  );
  return { count: rows.length };
}
