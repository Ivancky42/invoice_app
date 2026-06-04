import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asNumber, asString, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { runInTransactionBatches } from "@/lib/notion/batchTransaction";
import { queryAllPages } from "@/lib/notion/queryAll";

function mapPage(page: PageObjectResponse): Prisma.IdeaUncheckedCreateInput | null {
  const stockSector = asString(readProp(page, "Stock / Sector"));
  if (!stockSector) return null;

  return {
    notionId: page.id,
    stockSector,
    theme: asString(readProp(page, "Theme")),
    currentPrice: asNumber(readProp(page, "Current Price")) ?? null,
    analystTarget: asNumber(readProp(page, "Analyst Target")) ?? null,
    upsidePct: asNumber(readProp(page, "Upside %")) ?? null,
    riskLevel: asString(readProp(page, "Risk Level")),
    status: asString(readProp(page, "Status")),
    socialBuzz: asString(readProp(page, "Social Buzz")),
    foundVia: asString(readProp(page, "Found Via")),
    whyInteresting: asString(readProp(page, "Why Interesting")),
  };
}

export async function syncIdeas(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_IDEAS_DB");
  const pages = await queryAllPages(dbId);
  const rows = pages.map(mapPage).filter((r): r is Prisma.IdeaUncheckedCreateInput => r !== null);
  await runInTransactionBatches(
    rows.map((r) =>
      prisma.idea.upsert({ where: { notionId: r.notionId }, create: r, update: r }),
    ),
  );
  return { count: rows.length };
}
