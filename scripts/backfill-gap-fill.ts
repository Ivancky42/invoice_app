/**
 * Backfill Notion → Neon for the five gap-fill models/fields:
 * 1. Portfolio Add Zone / Next Add Trigger
 * 2. Decision Review Log
 * 3. Strategy Lessons + Investment Style ContentPages
 *
 * Usage: npx tsx scripts/backfill-gap-fill.ts
 * Requires NOTION_TOKEN + DB URLs. Decision Review also needs NOTION_DECISION_REVIEW_DB.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { queryAllPages } from "../src/lib/notion/queryAll";
import { notionDbId } from "../src/lib/notion/client";
import { asString, readProp } from "../src/lib/notion/extract";
import { syncDecisionReviews } from "../src/lib/notion/mappers/decisionReviews";
import { syncContentPages } from "../src/lib/notion/mappers/contentPages";

async function backfillPortfolioZones() {
  const dbId = notionDbId("NOTION_PORTFOLIO_DB");
  const pages = await queryAllPages(dbId);
  let updated = 0;
  for (const page of pages) {
    const ticker = asString(readProp(page, "Stock"));
    if (!ticker) continue;
    const addZone = asString(readProp(page, "Add Zone"));
    const nextAddTrigger = asString(readProp(page, "Next Add Trigger"));
    if (addZone == null && nextAddTrigger == null) continue;
    const result = await prisma.portfolio.updateMany({
      where: { ticker: { equals: ticker, mode: "insensitive" } },
      data: {
        ...(addZone != null ? { addZone } : {}),
        ...(nextAddTrigger != null ? { nextAddTrigger } : {}),
      },
    });
    updated += result.count;
  }
  return { pages: pages.length, updated };
}

async function main() {
  if (!process.env.NOTION_DECISION_REVIEW_DB?.trim()) {
    process.env.NOTION_DECISION_REVIEW_DB = "a5a21adf867e4d75b28a7bf97a639c03";
  }

  console.log("1/3 Portfolio Add Zone / Next Add Trigger…");
  const zones = await backfillPortfolioZones();
  console.log(zones);

  console.log("2/3 Decision Review Log…");
  const decisions = await syncDecisionReviews();
  console.log(decisions);

  console.log("3/3 Strategy Lessons + Investment Style…");
  const docs = await syncContentPages();
  console.log(docs);

  const counts = {
    decisionReviews: await prisma.decisionReview.count(),
    contentPages: await prisma.contentPage.count(),
    portfolioWithAddZone: await prisma.portfolio.count({
      where: { addZone: { not: null } },
    }),
  };
  console.log("Done:", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
