/**
 * Backfill Portfolio.addsUsed from historical ADD trades that were average-downs
 * (price < avgCostBasis), matching logTrade.countHistoricalAverageDowns.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage: npx tsx scripts/backfill-adds-used.ts [--apply]
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";
import { decToNum, isCashTicker } from "../src/lib/stocks/format";

const apply = process.argv.includes("--apply");

const pool = new Pool({
  connectionString: normalizePgConnectionString(process.env.DATABASE_URL!),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function countAverageDowns(ticker: string): Promise<number> {
  const adds = await prisma.trade.findMany({
    where: { ticker, type: "ADD" },
    select: { pricePerShare: true, avgCostBasis: true },
  });
  let n = 0;
  for (const t of adds) {
    const price = decToNum(t.pricePerShare);
    const avg = decToNum(t.avgCostBasis);
    if (price !== null && avg !== null && avg > 0 && price < avg) n += 1;
  }
  return n;
}

async function main() {
  console.log(apply ? "APPLY mode — writing addsUsed\n" : "DRY-RUN — no writes\n");
  const rows = await prisma.portfolio.findMany();
  let would = 0;
  let updated = 0;

  for (const row of rows) {
    if (isCashTicker(row.ticker)) continue;
    const used = await countAverageDowns(row.ticker);
    if (row.addsUsed === used) continue;
    would += 1;
    console.log(`${row.ticker}: addsUsed ${row.addsUsed ?? "null"} → ${used}`);
    if (apply) {
      await prisma.portfolio.update({
        where: { id: row.id },
        data: { addsUsed: used },
      });
      updated += 1;
    }
  }

  console.log(apply ? `\nUpdated ${updated} rows.` : `\nWould update ${would} rows.`);
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
