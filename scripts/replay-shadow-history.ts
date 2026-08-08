/**
 * Wipe the collapsed shadow ledger and chronologically re-replay DecisionReviews.
 *
 * The daily cron dates sessions from DR.decisionDate (preferred) but only looks back
 * ~14 days of *createdAt* and cannot fill historical buys before historical sells in one
 * pass. This script walks the session calendar so fills precede later sells.
 *
 * Usage:
 *   npx tsx scripts/replay-shadow-history.ts --dry-run [--branch=LIVE|CANDIDATE|ALL]
 *   npx tsx scripts/replay-shadow-history.ts --confirm-destructive [--branch=…]
 *
 * Remote/prod DATABASE_URL requires `--confirm-destructive`. Never commit prod URLs.
 */
import "dotenv/config";
import type { Branch } from "../src/generated/prisma/client";
import {
  resolvePendingCounterfactuals,
  seedCounterfactualsForBranch,
  type SeedableDecisionRow,
} from "../src/lib/fitness/counterfactuals";
import { runFitnessSnapshot } from "../src/lib/fitness/snapshot";
import { prisma } from "../src/lib/prisma";
import {
  ensureShadowBranches,
  listBranches,
  SHADOW_INITIAL_NAV,
} from "../src/lib/shadow/branches";
import { dedupeDecisionsForShadow } from "../src/lib/shadow/dedupe";
import {
  enqueueDecisionsForBranch,
  type EnqueueDecisionRow,
} from "../src/lib/shadow/enqueue";
import { runShadowFill } from "../src/lib/shadow/fill";
import { runShadowMark } from "../src/lib/shadow/mark";
import {
  clearSessionCache,
  decisionSessionForReview,
  loadSessions,
  sessionDate,
  ymd,
} from "../src/lib/shadow/sessions";
import { decToNum } from "../src/lib/stocks/format";
import { assertDestructiveAllowed } from "./lib/db-target-guard";

const ORDER_TYPES = ["BUY", "ADD", "AVERAGE_DOWN", "REDUCE", "EXIT"] as const;
const SEEDABLE_TYPES = ["AVOID", "WAIT", "DO_NOT_AVERAGE_DOWN"] as const;

const dryRun = process.argv.includes("--dry-run");
const branchArg =
  process.argv.find((a) => a.startsWith("--branch="))?.slice("--branch=".length) ?? "ALL";

function parseBranches(): Branch[] {
  const upper = branchArg.toUpperCase();
  if (upper === "ALL") return ["LIVE", "CANDIDATE"];
  if (upper === "LIVE" || upper === "CANDIDATE") return [upper];
  throw new Error(`--branch must be LIVE|CANDIDATE|ALL, got: ${branchArg}`);
}

/** Soft budget that never trips during a offline replay walk. */
function infiniteBudget() {
  return { remainingMs: () => 60_000 };
}

type LoadedDr = EnqueueDecisionRow & SeedableDecisionRow;

async function wipeBranch(branchId: string, branch: Branch): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.counterfactual.deleteMany({ where: { branchId } }),
    prisma.fitnessSnapshot.deleteMany({ where: { branchId } }),
    prisma.shadowOrder.deleteMany({ where: { branchId } }),
    prisma.shadowPosition.updateMany({
      where: { branchId, closedAt: null },
      data: { closedAt: now, shares: 0, markStale: false },
    }),
    prisma.shadowPosition.deleteMany({ where: { branchId } }),
    prisma.shadowBranch.update({
      where: { id: branchId },
      data: {
        startNav: SHADOW_INITIAL_NAV,
        cash: SHADOW_INITIAL_NAV,
        highWaterNav: SHADOW_INITIAL_NAV,
        resetAt: now,
      },
    }),
  ]);
  console.log(`  wiped ${branch} (${branchId})`);
}

async function loadDecisions(branch: Branch): Promise<LoadedDr[]> {
  const rows = await prisma.decisionReview.findMany({
    where: {
      branch,
      ticker: { not: null },
      decisionType: {
        in: [...ORDER_TYPES, ...SEEDABLE_TYPES],
      },
    },
    select: {
      id: true,
      ticker: true,
      decisionType: true,
      convictionScore: true,
      createdAt: true,
      decisionDate: true,
      notionId: true,
      idempotencyKey: true,
      priceAtDecision: true,
    },
    orderBy: [{ decisionDate: "asc" }, { createdAt: "asc" }],
  });
  return dedupeDecisionsForShadow(rows) as LoadedDr[];
}

async function printSummary(branchIds: string[]): Promise<void> {
  const orders = await prisma.shadowOrder.groupBy({
    by: ["status"],
    where: { branchId: { in: branchIds } },
    _count: true,
  });
  const cfs = await prisma.counterfactual.groupBy({
    by: ["status"],
    where: { branchId: { in: branchIds } },
    _count: true,
  });
  console.log("\nShadowOrder by status:");
  for (const row of orders) console.log(`  ${row.status}: ${row._count}`);
  console.log("Counterfactual by status:");
  for (const row of cfs) console.log(`  ${row.status}: ${row._count}`);

  const samples = await prisma.counterfactual.findMany({
    where: { branchId: { in: branchIds } },
    orderBy: { decisionSession: "asc" },
    take: 8,
    select: {
      ticker: true,
      decisionType: true,
      decisionSession: true,
      priceAtDecision: true,
      decisionReviewId: true,
    },
  });
  if (samples.length === 0) return;

  const drIds = samples.map((s) => s.decisionReviewId);
  const drs = await prisma.decisionReview.findMany({
    where: { id: { in: drIds } },
    select: { id: true, decisionDate: true, priceAtDecision: true },
  });
  const byId = new Map(drs.map((d) => [d.id, d]));

  console.log("\nSample counterfactuals (decisionSession / priceAtDecision vs DR):");
  for (const s of samples) {
    const dr = byId.get(s.decisionReviewId);
    console.log(
      `  ${s.ticker} ${s.decisionType} session=${ymd(s.decisionSession)} @$${decToNum(s.priceAtDecision)}` +
        ` | DR date=${dr?.decisionDate ? ymd(dr.decisionDate) : "null"}` +
        ` DR@$${dr?.priceAtDecision != null ? decToNum(dr.priceAtDecision) : "null"}`,
    );
  }
}

async function main() {
  const targetBranches = parseBranches();
  console.log(
    `Shadow history replay: dryRun=${dryRun} branches=${targetBranches.join(",")}\n`,
  );

  await ensureShadowBranches();
  clearSessionCache();
  const sessions = await loadSessions();
  if (sessions.length === 0) {
    throw new Error("No session calendar — backfill PriceHistory anchors first.");
  }

  const allBranches = await listBranches();
  const branches = allBranches.filter((b) => targetBranches.includes(b.branch));
  if (branches.length === 0) {
    throw new Error(`No ShadowBranch rows for ${targetBranches.join(",")}`);
  }

  // Prefetch + date every DR once.
  type Dated = LoadedDr & { decisionSession: string };
  const byBranch = new Map<string, { order: Dated[]; seedable: Dated[] }>();
  let earliest: string | null = null;

  for (const branchRow of branches) {
    const loaded = await loadDecisions(branchRow.branch);
    const dated: Dated[] = [];
    for (const dr of loaded) {
      const day = decisionSessionForReview(sessions, dr);
      if (!day) {
        console.warn(
          `  skip undated ${branchRow.branch} ${dr.ticker} ${dr.decisionType} id=${dr.id}`,
        );
        continue;
      }
      dated.push({ ...dr, decisionSession: day });
      if (!earliest || day < earliest) earliest = day;
    }
    byBranch.set(branchRow.id, {
      order: dated.filter((d) =>
        ORDER_TYPES.includes(d.decisionType as (typeof ORDER_TYPES)[number]),
      ),
      seedable: dated.filter((d) =>
        SEEDABLE_TYPES.includes(d.decisionType as (typeof SEEDABLE_TYPES)[number]),
      ),
    });
    console.log(
      `  ${branchRow.branch}: ${dated.length} dated DRs` +
        ` (${byBranch.get(branchRow.id)!.order.length} orders,` +
        ` ${byBranch.get(branchRow.id)!.seedable.length} seedable)`,
    );
  }

  if (!earliest) {
    console.log("Nothing to replay.");
    return;
  }

  const latest = sessions[sessions.length - 1]!;
  const walkStartIdx = sessions.findIndex((s) => s >= earliest);
  if (walkStartIdx < 0) {
    throw new Error(`Earliest decisionSession ${earliest} is after the calendar end.`);
  }
  const walk = sessions.slice(walkStartIdx);
  console.log(`\nSession walk: ${walk[0]} → ${latest} (${walk.length} sessions)`);

  if (dryRun) {
    console.log("\nDry run — no writes. Sample dated decisions:");
    for (const branchRow of branches) {
      const { order, seedable } = byBranch.get(branchRow.id)!;
      for (const dr of [...order, ...seedable].slice(0, 5)) {
        console.log(
          `  ${branchRow.branch} ${dr.ticker} ${dr.decisionType}` +
            ` decisionDate=${dr.decisionDate ? ymd(dr.decisionDate) : "null"}` +
            ` → session=${dr.decisionSession}`,
        );
      }
    }
    return;
  }

  assertDestructiveAllowed("wipe + re-replay the shadow ledger");

  for (const branchRow of branches) {
    await wipeBranch(branchRow.id, branchRow.branch);
  }
  clearSessionCache();

  const budget = infiniteBudget();
  let filledTotal = 0;
  let enqueuedTotal = 0;
  let seededTotal = 0;
  let resolvedTotal = 0;
  let unresolvedTotal = 0;

  for (const sessionDay of walk) {
    const runDay = sessionDate(sessionDay);
    const onlyBranchIds = branches.map((b) => b.id);

    // fill → enqueue → mark → seed refusals — same dependency order as cron.
    // Scope to the wiped branches so a LIVE-only replay cannot fill stale CANDIDATE orders.
    const fill = await runShadowFill({ runDay, cursor: null, budget }, { onlyBranchIds });
    const fillDetail = fill.detail as { filled?: number } | undefined;
    filledTotal += fillDetail?.filled ?? 0;

    for (const branchRow of branches) {
      const { order } = byBranch.get(branchRow.id)!;
      const ordersToday = order.filter((d) => d.decisionSession === sessionDay);

      if (ordersToday.length > 0) {
        const result = await enqueueDecisionsForBranch(
          branchRow,
          sessions,
          ordersToday,
          runDay,
          budget,
        );
        enqueuedTotal += result.enqueued;
      }
    }

    await runShadowMark({ runDay, cursor: null, budget }, { onlyBranchIds });

    for (const branchRow of branches) {
      const { seedable } = byBranch.get(branchRow.id)!;
      const seedableToday = seedable.filter((d) => d.decisionSession === sessionDay);
      if (seedableToday.length > 0) {
        const result = await seedCounterfactualsForBranch(
          branchRow,
          sessions,
          seedableToday,
          runDay,
          budget,
        );
        seededTotal += result.seeded;
      }
    }

    // Resolve BEFORE the snapshot so credits whose horizon elapsed on this session (or in
    // a cron gap ending here) land in this row's avoidedCreditDelta. Resolve-at-end left
    // every historical snapshot at credit 0. Scope to wiped branches so a LIVE-only
    // replay cannot resolve (and stamp) CANDIDATE counterfactuals.
    const dayResolution = await resolvePendingCounterfactuals(sessions, runDay, budget, {
      onlyBranchIds,
    });
    resolvedTotal += dayResolution.resolved;
    unresolvedTotal += dayResolution.unresolved;

    await runFitnessSnapshot({ runDay, cursor: null, budget }, { onlyBranchIds });
  }

  console.log(
    `\nDone. filled≈${filledTotal} enqueued=${enqueuedTotal} seeded=${seededTotal}` +
      ` resolved=${resolvedTotal} unresolved=${unresolvedTotal}`,
  );
  await printSummary(branches.map((b) => b.id));
  console.log(
    "\nKeep EVOLUTION_PROMOTE=0 until you spot-check prices, then clear it to re-enable promotion.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
