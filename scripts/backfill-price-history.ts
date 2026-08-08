/**
 * EODHD bulk backfill of PriceHistory (stooq fallback per ticker on EODHD error).
 * Prints a per-ticker coverage table; exits 1 if any ticker ended in error.
 *
 * Usage: npx tsx scripts/backfill-price-history.ts [--days=400] [--dry-run] [--overwrite]
 *
 * --overwrite: upsert every fetched bar, replacing existing `(ticker, date)`
 * rows with the provider's full bar (repairs bad nightly closes). Default is
 * insert-only (`skipDuplicates`), which never touches existing rows.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";
import { backfillTicker, writeBackfillBars } from "../src/lib/pricehistory/backfill";
import { buildPriceHistoryUniverse } from "../src/lib/pricehistory/symbols";

const DEFAULT_DAYS = 400;

const dryRun = process.argv.includes("--dry-run");
const overwrite = process.argv.includes("--overwrite");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const days = daysArg ? Number(daysArg.slice("--days=".length)) : DEFAULT_DAYS;

const pool = new Pool({
  connectionString: normalizePgConnectionString(process.env.DATABASE_URL!),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function printTable(
  rows: { ticker: string; provider: string; rows: number; firstDate: string | null; lastDate: string | null; error: string | null }[],
): void {
  const header = ["ticker", "provider", "rows", "firstDate", "lastDate", "error"];
  console.log(header.join(" | "));
  for (const r of rows) {
    console.log(
      [r.ticker, r.provider, String(r.rows), r.firstDate ?? "-", r.lastDate ?? "-", r.error ?? ""].join(
        " | ",
      ),
    );
  }
}

async function main() {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`--days must be a positive number, got: ${daysArg ?? DEFAULT_DAYS}`);
  }

  console.log(`Backfilling PriceHistory: days=${days} dryRun=${dryRun} overwrite=${overwrite}\n`);

  const universe = await buildPriceHistoryUniverse();
  const eodhdKey = process.env.EODHD_API_KEY?.trim();

  const results = [];
  for (const ticker of universe) {
    const result = await backfillTicker(ticker, days, eodhdKey);
    results.push(result);

    if (!dryRun && result.bars.length > 0) {
      await writeBackfillBars(prisma.priceHistory, result.bars, { overwrite });
    }
  }

  printTable(results);

  const hasError = results.some((r) => r.error !== null);
  if (hasError) {
    console.error(`\n${results.filter((r) => r.error !== null).length} ticker(s) ended in error.`);
    process.exitCode = 1;
  } else {
    console.log(`\nOK: ${results.length} tickers processed.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
