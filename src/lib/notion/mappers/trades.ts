import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asDate, asNumber, asString, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { runInTransactionBatches } from "@/lib/notion/batchTransaction";
import { queryAllPages } from "@/lib/notion/queryAll";
import { toJsonBlocks } from "@/lib/notion/jsonBlocks";
import { normalizeTradeStatus, normalizeTradeType } from "@/lib/stocks/normalizeStatus";

function mapPage(page: PageObjectResponse): Prisma.TradeUncheckedCreateInput | null {
  const title = asString(readProp(page, "Trade"));
  if (!title) return null;

  const typeRaw = asString(readProp(page, "Type"));
  const statusRaw = asString(readProp(page, "Status"));

  return {
    notionId: page.id,
    title,
    ticker: asString(readProp(page, "Ticker")),
    typeRaw,
    type: normalizeTradeType(typeRaw),
    date: asDate(readProp(page, "Date")),
    pricePerShare: asNumber(readProp(page, "Price Per Share")) ?? null,
    shares: asNumber(readProp(page, "Shares")) ?? null,
    totalValue: asNumber(readProp(page, "Total Value")) ?? null,
    pnlDollar: asNumber(readProp(page, "P&L $")) ?? null,
    pnlPct: asNumber(readProp(page, "P&L %")) ?? null,
    statusRaw,
    status: normalizeTradeStatus(statusRaw),
    avgCostBasis: asNumber(readProp(page, "Avg Cost Basis")) ?? null,
    exitReason: asString(readProp(page, "Exit Reason")),
    thesisAtEntry: toJsonBlocks(asString(readProp(page, "Thesis At Entry"))),
    notes: toJsonBlocks(asString(readProp(page, "Notes"))),
  };
}

export async function syncTrades(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_TRADES_DB");
  const pages = await queryAllPages(dbId);
  const rows = pages.map(mapPage).filter((r): r is Prisma.TradeUncheckedCreateInput => r !== null);
  await runInTransactionBatches(
    rows.map((r) => {
      const { notionId, ...update } = r;
      if (!notionId) throw new Error("Trade sync row missing notionId");
      return prisma.trade.upsert({ where: { notionId }, create: r, update });
    }),
  );
  return { count: rows.length };
}
