/**
 * Seed Stock HQ Config keys from Neon portfolio/watchlist + migration-plan defaults.
 * Idempotent upserts.
 *
 * Usage: npx tsx scripts/seed-config.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";
import { isCashTicker, notionCashBalanceUsd } from "../src/lib/stocks/format";

const DEFAULT_FX = 4.2;

const KEYS = {
  CASH_POSITION_USD: "CASH_POSITION_USD",
  CASH_POSITION_MYR: "CASH_POSITION_MYR",
  FX_RATE_USD_MYR: "FX_RATE_USD_MYR",
  CASH_LAST_UPDATED: "CASH_LAST_UPDATED",
  LIMITS: "LIMITS",
  SENTIMENT_THRESHOLDS: "SENTIMENT_THRESHOLDS",
  EARNINGS_RISK_THRESHOLDS: "EARNINGS_RISK_THRESHOLDS",
  TRACKED_TICKERS: "TRACKED_TICKERS",
} as const;

const LIMITS = {
  singlePositionPct: 0.15,
  themePct: 0.3,
  speculativeSleevePct: 0.15,
  cashFloorPct: 0.05,
  maxAverageDowns: 2,
  tierBands: {
    TEST_STARTER: [0.02, 0.03],
    CONFIRMATION: [0.05, 0.06],
    CONVICTION: [0, 0.08],
  },
};

const pool = new Pool({
  connectionString: normalizePgConnectionString(process.env.DATABASE_URL!),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function upsert(key: string, value: Prisma.InputJsonValue) {
  await prisma.config.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  console.log(`  upserted ${key}`);
}

async function main() {
  console.log("Seeding Config…\n");

  const cashRow = await prisma.portfolio.findFirst({
    where: { ticker: { equals: "CASH_USD", mode: "insensitive" } },
  });

  const cashUsd = cashRow
    ? notionCashBalanceUsd(cashRow.currentPrice, cashRow.myAvgCost)
    : 0;
  if (!cashRow) {
    console.warn("WARNING: no CASH_USD portfolio row — CASH_POSITION_USD=0");
  }

  let fxRate = DEFAULT_FX;
  const existingFx = await prisma.config.findUnique({
    where: { key: KEYS.FX_RATE_USD_MYR },
  });
  if (existingFx && typeof existingFx.value === "number" && Number.isFinite(existingFx.value)) {
    fxRate = existingFx.value;
  } else {
    console.warn(`WARNING: FX_RATE_USD_MYR unknown — using default ${DEFAULT_FX}`);
  }

  const cashMyr = cashUsd * fxRate;
  const lastUpdated =
    cashRow?.lastPriceUpdate?.toISOString() ??
    cashRow?.syncedAt?.toISOString() ??
    new Date().toISOString();

  await upsert(KEYS.CASH_POSITION_USD, cashUsd);
  await upsert(KEYS.CASH_POSITION_MYR, cashMyr);
  await upsert(KEYS.FX_RATE_USD_MYR, fxRate);
  await upsert(KEYS.CASH_LAST_UPDATED, lastUpdated);

  await upsert(KEYS.LIMITS, LIMITS);

  await upsert(KEYS.SENTIMENT_THRESHOLDS, {
    veryBullish: 80,
    bullish: 60,
    neutral: 40,
  });

  await upsert(KEYS.EARNINGS_RISK_THRESHOLDS, {
    imminentMaxDays: 13,
    soonMaxDays: 45,
  });

  const [portfolioRows, watchlistRows] = await Promise.all([
    prisma.portfolio.findMany({ select: { ticker: true }, orderBy: { ticker: "asc" } }),
    prisma.watchlist.findMany({ select: { ticker: true }, orderBy: { ticker: "asc" } }),
  ]);

  const portfolioTickers = portfolioRows
    .map((r) => r.ticker.trim().toUpperCase())
    .filter((t) => t && !isCashTicker(t));
  const watchlistTickers = watchlistRows
    .map((r) => r.ticker.trim().toUpperCase())
    .filter(Boolean);

  await upsert(KEYS.TRACKED_TICKERS, {
    portfolio: portfolioTickers,
    watchlist: watchlistTickers,
  });

  console.log("\nDone. Keys:");
  for (const key of Object.values(KEYS)) {
    console.log(`  - ${key}`);
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
