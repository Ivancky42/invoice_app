/**
 * Compare Portfolio.shares (Notion source) vs holdingsByTicker(trades).
 * Report-only — always exits 0; never auto-fixes from trades.
 *
 * Usage: npx tsx scripts/diff-shares.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";
import { decToNum, holdingsByTicker } from "../src/lib/stocks/format";

const pool = new Pool({
  connectionString: normalizePgConnectionString(process.env.DATABASE_URL!),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function fmtShares(n: number | null): string {
  if (n === null) return "null";
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, "");
}

async function main() {
  const [portfolio, trades] = await Promise.all([
    prisma.portfolio.findMany({
      select: { ticker: true, shares: true },
      orderBy: { ticker: "asc" },
    }),
    prisma.trade.findMany(),
  ]);

  const fromTrades = holdingsByTicker(trades);
  const portfolioTickers = new Set(portfolio.map((p) => p.ticker));

  type Row = {
    ticker: string;
    notionShares: number | null;
    tradeShares: number | null;
    delta: number | null;
  };

  const rows: Row[] = [];

  for (const p of portfolio) {
    const notionShares = decToNum(p.shares);
    const tradeShares = fromTrades.has(p.ticker) ? fromTrades.get(p.ticker)! : null;
    const bothNull = notionShares === null && tradeShares === null;
    const equal =
      notionShares !== null &&
      tradeShares !== null &&
      Math.abs(notionShares - tradeShares) < 1e-6;
    if (bothNull || equal) continue;
    rows.push({
      ticker: p.ticker,
      notionShares,
      tradeShares,
      delta:
        notionShares !== null && tradeShares !== null
          ? notionShares - tradeShares
          : null,
    });
  }

  // Trade holdings with no portfolio row
  for (const [ticker, tradeShares] of fromTrades) {
    if (portfolioTickers.has(ticker)) continue;
    rows.push({
      ticker,
      notionShares: null,
      tradeShares,
      delta: null,
    });
  }

  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));

  console.log("Portfolio.shares (Notion) vs holdingsByTicker(trades)");
  console.log(`Portfolio rows: ${portfolio.length} | Trade holding tickers: ${fromTrades.size}`);
  console.log("");

  if (rows.length === 0) {
    console.log("No disagreements.");
  } else {
    console.log(`Disagreements (${rows.length}):`);
    console.log(
      [
        "ticker".padEnd(12),
        "notion".padStart(12),
        "trades".padStart(12),
        "delta".padStart(12),
      ].join(" "),
    );
    console.log("-".repeat(52));
    for (const r of rows) {
      console.log(
        [
          r.ticker.padEnd(12),
          fmtShares(r.notionShares).padStart(12),
          fmtShares(r.tradeShares).padStart(12),
          fmtShares(r.delta).padStart(12),
        ].join(" "),
      );
    }
  }

  // Always exit 0 — report only
  process.exitCode = 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 0; // still report-only exit 0
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
