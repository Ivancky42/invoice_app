/**
 * Backfill enum columns from *Raw (or legacy string) values.
 *
 * Dry-run by default. Pass --apply to write.
 * Unmatched distinct values are printed; never defaulted.
 *
 * Usage: npx tsx scripts/normalize-statuses.ts [--apply]
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";
import {
  normalizeAnalystRating,
  normalizeDiscoveredVia,
  normalizeIdeaStage,
  normalizeIdeaStatus,
  normalizeMarketCapBucket,
  normalizePositionAction,
  normalizeRiskLevel,
  normalizeTradeStatus,
  normalizeTradeType,
  normalizeTrendStage,
  normalizeTrendVerdict,
  normalizeWatchlistPriority,
  normalizeWeekMomentum,
} from "../src/lib/stocks/normalizeStatus";

const apply = process.argv.includes("--apply");

const pool = new Pool({
  connectionString: normalizePgConnectionString(process.env.DATABASE_URL!),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type Unmatched = Map<string, Set<string>>;

function noteUnmatched(bag: Unmatched, field: string, raw: string) {
  if (!bag.has(field)) bag.set(field, new Set());
  bag.get(field)!.add(raw);
}

async function main() {
  const unmatched: Unmatched = new Map();
  let wouldUpdate = 0;
  let updated = 0;

  console.log(apply ? "APPLY mode — writing enum columns\n" : "DRY-RUN — no writes\n");

  // --- Portfolio ---
  const portfolios = await prisma.portfolio.findMany();
  for (const row of portfolios) {
    const actionRaw = row.actionRaw;
    const riskRaw = row.riskLevelRaw;
    const ratingRaw = row.analystRatingRaw;
    const capRaw = row.marketCapBucketRaw;

    const action = normalizePositionAction(actionRaw);
    const riskLevel = normalizeRiskLevel(riskRaw);
    const analystRating = normalizeAnalystRating(ratingRaw);
    const marketCapBucket = normalizeMarketCapBucket(capRaw);

    if (actionRaw && !action) noteUnmatched(unmatched, "Portfolio.actionRaw", actionRaw);
    if (riskRaw && !riskLevel) noteUnmatched(unmatched, "Portfolio.riskLevelRaw", riskRaw);
    if (ratingRaw && !analystRating) noteUnmatched(unmatched, "Portfolio.analystRatingRaw", ratingRaw);
    if (capRaw && !marketCapBucket) noteUnmatched(unmatched, "Portfolio.marketCapBucketRaw", capRaw);

    const data = {
      action,
      riskLevel,
      analystRating,
      marketCapBucket,
    };
    const changed =
      row.action !== data.action ||
      row.riskLevel !== data.riskLevel ||
      row.analystRating !== data.analystRating ||
      row.marketCapBucket !== data.marketCapBucket;
    if (!changed) continue;
    wouldUpdate++;
    if (apply) {
      await prisma.portfolio.update({ where: { id: row.id }, data });
      updated++;
    }
  }

  // --- Watchlist ---
  const watchlist = await prisma.watchlist.findMany();
  for (const row of watchlist) {
    const priorityRaw = row.priorityRaw;
    const riskRaw = row.riskLevelRaw;
    const ratingRaw = row.analystRatingRaw;
    const capRaw = row.marketCapBucketRaw;

    const priority = normalizeWatchlistPriority(priorityRaw);
    const riskLevel = normalizeRiskLevel(riskRaw);
    const analystRating = normalizeAnalystRating(ratingRaw);
    const marketCapBucket = normalizeMarketCapBucket(capRaw);

    if (priorityRaw && !priority) noteUnmatched(unmatched, "Watchlist.priorityRaw", priorityRaw);
    if (riskRaw && !riskLevel) noteUnmatched(unmatched, "Watchlist.riskLevelRaw", riskRaw);
    if (ratingRaw && !analystRating) noteUnmatched(unmatched, "Watchlist.analystRatingRaw", ratingRaw);
    if (capRaw && !marketCapBucket) noteUnmatched(unmatched, "Watchlist.marketCapBucketRaw", capRaw);

    const data = { priority, riskLevel, analystRating, marketCapBucket };
    const changed =
      row.priority !== data.priority ||
      row.riskLevel !== data.riskLevel ||
      row.analystRating !== data.analystRating ||
      row.marketCapBucket !== data.marketCapBucket;
    if (!changed) continue;
    wouldUpdate++;
    if (apply) {
      await prisma.watchlist.update({ where: { id: row.id }, data });
      updated++;
    }
  }

  // --- Trade ---
  const trades = await prisma.trade.findMany();
  for (const row of trades) {
    const typeRaw = row.typeRaw;
    const statusRaw = row.statusRaw;
    const type = normalizeTradeType(typeRaw);
    const status = normalizeTradeStatus(statusRaw);
    if (typeRaw && !type) noteUnmatched(unmatched, "Trade.typeRaw", typeRaw);
    if (statusRaw && !status) noteUnmatched(unmatched, "Trade.statusRaw", statusRaw);
    const data = { type, status };
    const changed = row.type !== data.type || row.status !== data.status;
    if (!changed) continue;
    wouldUpdate++;
    if (apply) {
      await prisma.trade.update({ where: { id: row.id }, data });
      updated++;
    }
  }

  // --- Trend ---
  const trends = await prisma.trend.findMany();
  for (const row of trends) {
    const stageRaw = row.lifecycleStageRaw;
    const verdictRaw = row.verdictRaw;
    const momRaw = row.weekMomentumRaw;
    const viaRaw = row.discoveredViaRaw;
    const lifecycleStage = normalizeTrendStage(stageRaw);
    const verdict = normalizeTrendVerdict(verdictRaw);
    const weekMomentum = normalizeWeekMomentum(momRaw);
    const discoveredVia = normalizeDiscoveredVia(viaRaw);
    if (stageRaw && !lifecycleStage) noteUnmatched(unmatched, "Trend.lifecycleStageRaw", stageRaw);
    if (verdictRaw && !verdict) noteUnmatched(unmatched, "Trend.verdictRaw", verdictRaw);
    if (momRaw && !weekMomentum) noteUnmatched(unmatched, "Trend.weekMomentumRaw", momRaw);
    if (viaRaw && !discoveredVia) noteUnmatched(unmatched, "Trend.discoveredViaRaw", viaRaw);
    const data = { lifecycleStage, verdict, weekMomentum, discoveredVia };
    const changed =
      row.lifecycleStage !== data.lifecycleStage ||
      row.verdict !== data.verdict ||
      row.weekMomentum !== data.weekMomentum ||
      row.discoveredVia !== data.discoveredVia;
    if (!changed) continue;
    wouldUpdate++;
    if (apply) {
      await prisma.trend.update({ where: { id: row.id }, data });
      updated++;
    }
  }

  // --- Idea ---
  const ideas = await prisma.idea.findMany();
  for (const row of ideas) {
    const statusRaw = row.statusRaw;
    const status = normalizeIdeaStatus(statusRaw);
    if (statusRaw && !status) noteUnmatched(unmatched, "Idea.statusRaw", statusRaw);

    const ideaStageRaw = row.ideaStageRaw;
    const ideaStage = normalizeIdeaStage(ideaStageRaw);
    if (ideaStageRaw && !ideaStage) noteUnmatched(unmatched, "Idea.ideaStageRaw", ideaStageRaw);

    const data = { status, ideaStage };
    if (row.status === data.status && row.ideaStage === data.ideaStage) continue;
    wouldUpdate++;
    if (apply) {
      await prisma.idea.update({ where: { id: row.id }, data });
      updated++;
    }
  }

  console.log(apply ? `Updated ${updated} rows.` : `Would update ${wouldUpdate} rows.`);
  console.log("\n=== Unmatched distinct values ===");
  if (unmatched.size === 0) {
    console.log("(none)");
  } else {
    for (const [field, vals] of [...unmatched.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`\n${field}:`);
      for (const v of [...vals].sort()) console.log(`  ${JSON.stringify(v)}`);
    }
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
