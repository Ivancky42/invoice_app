import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asDate, asNumber, asString, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { runInTransactionBatches } from "@/lib/notion/batchTransaction";
import { queryAllPages } from "@/lib/notion/queryAll";
import { toJsonBlocks } from "@/lib/notion/jsonBlocks";
import {
  normalizeIdeaStage,
  normalizeIdeaStatus,
  normalizeTheme,
} from "@/lib/stocks/normalizeStatus";

function mapPage(page: PageObjectResponse): Prisma.IdeaUncheckedCreateInput | null {
  const stockSector = asString(readProp(page, "Stock / Sector"));
  if (!stockSector) return null;

  const statusRaw = asString(readProp(page, "Status"));
  const themeRaw = asString(readProp(page, "Theme"));
  const ideaStageRaw = asString(readProp(page, "Stage"));

  return {
    notionId: page.id,
    stockSector,
    leadTicker: asString(readProp(page, "Lead Ticker")),
    company: asString(readProp(page, "Company")),
    themeRaw,
    theme: normalizeTheme(themeRaw),
    currentPrice: asNumber(readProp(page, "Current Price")) ?? null,
    analystTarget: asNumber(readProp(page, "Analyst Target")) ?? null,
    upsidePct: asNumber(readProp(page, "Upside %")) ?? null,
    riskLevel: asString(readProp(page, "Risk Level")),
    statusRaw,
    status: normalizeIdeaStatus(statusRaw),
    ideaStageRaw,
    ideaStage: normalizeIdeaStage(ideaStageRaw),
    socialBuzz: asString(readProp(page, "Social Buzz")),
    foundVia: asString(readProp(page, "Found Via")),
    whyInteresting: toJsonBlocks(asString(readProp(page, "Why Interesting"))),
    keyRisk: asString(readProp(page, "Key Risk")),
    notes: toJsonBlocks(asString(readProp(page, "Notes"))),
    catalystDate: asDate(readProp(page, "Catalyst Date")),
    dateFound: asDate(readProp(page, "Date Found")),
    lastReviewed: asDate(readProp(page, "Last Reviewed")),
    graduationDate: asDate(readProp(page, "Graduation Date")),
    graduationPrice: asNumber(readProp(page, "Graduation Price")) ?? null,
  };
}

export async function syncIdeas(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_IDEAS_DB");
  const pages = await queryAllPages(dbId);
  const rows = pages.map(mapPage).filter((r): r is Prisma.IdeaUncheckedCreateInput => r !== null);
  await runInTransactionBatches(
    rows.map((r) => {
      const { notionId, ...update } = r;
      if (!notionId) throw new Error("Idea sync row missing notionId");
      return prisma.idea.upsert({ where: { notionId }, create: r, update });
    }),
  );
  return { count: rows.length };
}
