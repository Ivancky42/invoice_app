/**
 * Resolve pending counterfactuals, then patch avoidedCreditDelta (and the fitness terms
 * that depend on it) on existing FitnessSnapshot rows — WITHOUT recomputing nav.
 *
 * `runFitnessSnapshot` / `branchBook` mark the CURRENT open book at a historical session's
 * closes, so a full chronological re-snap would corrupt past nav / maxDrawdown. This
 * script only refreshes the credit stream and the derived fitnessIncrement / windowFitness.
 *
 * For a wipe-and-rebuild of the paper book itself, use `replay-shadow-history.ts`.
 *
 * Usage:
 *   npx tsx scripts/rebuild-fitness-series.ts --dry-run
 *   npx tsx scripts/rebuild-fitness-series.ts --confirm-write
 *
 * Remote/prod DATABASE_URL requires `--confirm-write`.
 */
import "dotenv/config";
import type { Branch } from "../src/generated/prisma/client";
import { resolvePendingCounterfactuals } from "../src/lib/fitness/counterfactuals";
import {
  drawdownPenalty,
  maxDrawdown,
  windowReturn,
} from "../src/lib/fitness/math";
import { FITNESS_WINDOW_SESSIONS, benchmarkCloseAt } from "../src/lib/fitness/snapshot";
import { prisma } from "../src/lib/prisma";
import { CSPX_TICKER } from "../src/lib/pricehistory/symbols";
import { ensureShadowBranches, listBranches } from "../src/lib/shadow/branches";
import {
  clearSessionCache,
  indexOnOrBefore,
  loadSessions,
  sessionDate,
  ymd,
} from "../src/lib/shadow/sessions";
import { decToNum } from "../src/lib/stocks/format";
import { assertWriteAllowed } from "./lib/db-target-guard";

const dryRun = process.argv.includes("--dry-run");

function infiniteBudget() {
  return { remainingMs: () => 60_000 };
}

function roundFraction(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

async function patchBranch(
  branchRow: { id: string; branch: Branch },
  sessions: string[],
  cspxCloseByDay: Map<string, number>,
): Promise<{ creditSessions: number }> {
  const rows = await prisma.fitnessSnapshot.findMany({
    where: { branchId: branchRow.id },
    orderBy: { session: "asc" },
    select: {
      id: true,
      session: true,
      nav: true,
      dailyIncrement: true,
      benchmarkIncrement: true,
      turnoverDelta: true,
      maxDrawdown: true,
    },
  });

  let creditSessions = 0;
  const patched: {
    session: string;
    nav: number;
    avoidedCreditDelta: number;
    turnoverDelta: number;
    fitnessIncrement: number | null;
    windowFitness: number | null;
  }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const session = ymd(row.session);
    const prior = i > 0 ? rows[i - 1]! : null;
    const nav = decToNum(row.nav) ?? 0;
    const dailyIncrement = decToNum(row.dailyIncrement);
    const benchmarkIncrement = decToNum(row.benchmarkIncrement);
    const turnoverDelta = decToNum(row.turnoverDelta) ?? 0;

    const credits = await prisma.counterfactual.findMany({
      where: {
        branchId: branchRow.id,
        status: "RESOLVED",
        credit: { not: null },
        horizonSession: prior
          ? { gt: prior.session, lte: row.session }
          : { lte: row.session },
      },
      select: { credit: true },
    });
    const avoidedCreditDelta = roundFraction(
      credits.reduce((sum, c) => sum + (decToNum(c.credit) ?? 0), 0),
    );
    if (avoidedCreditDelta !== 0) creditSessions += 1;

    const fitnessIncrement =
      dailyIncrement === null || benchmarkIncrement === null
        ? null
        : roundFraction(
            dailyIncrement + avoidedCreditDelta - turnoverDelta - benchmarkIncrement,
          );

    patched.push({
      session,
      nav,
      avoidedCreditDelta,
      turnoverDelta,
      fitnessIncrement,
      windowFitness: null,
    });

    // Trailing window including this row; same span rule as snapshot.ts.
    const windowRows = patched.slice(-FITNESS_WINDOW_SESSIONS);
    let windowFitness: number | null = null;
    if (windowRows.length >= FITNESS_WINDOW_SESSIONS) {
      const windowStart = windowRows[0]!;
      const benchStart = benchmarkCloseAt(sessions, cspxCloseByDay, windowStart.session);
      const benchmarkNow = benchmarkCloseAt(sessions, cspxCloseByDay, session);
      if (benchStart !== null && benchStart > 0 && benchmarkNow !== null) {
        const windowNavs = windowRows.map((r) => r.nav);
        const spanRows = windowRows.slice(1);
        const creditSum = spanRows.reduce((sum, r) => sum + r.avoidedCreditDelta, 0);
        const turnoverSum = spanRows.reduce((sum, r) => sum + r.turnoverDelta, 0);
        windowFitness = roundFraction(
          windowReturn(windowNavs) +
            creditSum -
            drawdownPenalty({ maxDrawdown: maxDrawdown(windowNavs) }) -
            turnoverSum -
            (benchmarkNow / benchStart - 1),
        );
      }
    }
    patched[patched.length - 1]!.windowFitness = windowFitness;

    if (!dryRun) {
      await prisma.fitnessSnapshot.update({
        where: { id: row.id },
        data: {
          avoidedCreditDelta,
          fitnessIncrement,
          windowFitness,
          // Preserve nav, dailyIncrement, turnoverDelta, maxDrawdown, quality, etc.
        },
      });
    }
  }

  return { creditSessions };
}

async function main() {
  console.log(`Patch fitness credit stream: dryRun=${dryRun}\n`);

  await ensureShadowBranches();
  clearSessionCache();
  const [sessions, branches] = await Promise.all([loadSessions(), listBranches()]);
  if (sessions.length === 0) {
    throw new Error("No session calendar — PriceHistory anchors missing.");
  }

  const pending = await prisma.counterfactual.count({ where: { status: "PENDING" } });
  const snapCount = await prisma.fitnessSnapshot.count();
  console.log(`  branches: ${branches.map((b) => b.branch).join(",")}`);
  console.log(`  pending counterfactuals: ${pending}`);
  console.log(`  existing snapshots: ${snapCount}`);
  console.log(`  calendar end: ${sessions[sessions.length - 1]}`);

  if (dryRun && pending === 0 && snapCount === 0) {
    console.log("\nDry run — nothing to do.");
    return;
  }

  if (!dryRun) {
    assertWriteAllowed("resolve counterfactuals + patch fitness credit stream");
  }

  const budget = infiniteBudget();
  const latest = sessions[sessions.length - 1]!;
  if (!dryRun) {
    const resolution = await resolvePendingCounterfactuals(
      sessions,
      sessionDate(latest),
      budget,
    );
    console.log(
      `\nResolved: ${resolution.resolved}  unresolved: ${resolution.unresolved}` +
        `  truncated: ${resolution.truncated}`,
    );
  } else {
    console.log("\nDry run — skipping resolve writes.");
  }

  const at = indexOnOrBefore(sessions, latest);
  const from = sessionDate(
    sessions[Math.max(0, at - (FITNESS_WINDOW_SESSIONS * 2 + 3))]!,
  );
  const cspxBars = await prisma.priceHistory.findMany({
    where: {
      ticker: CSPX_TICKER,
      date: { gte: from, lte: sessionDate(latest) },
    },
    select: { date: true, close: true },
  });
  const cspxCloseByDay = new Map<string, number>();
  for (const bar of cspxBars) {
    const close = decToNum(bar.close);
    if (close !== null) cspxCloseByDay.set(ymd(bar.date), close);
  }

  for (const branchRow of branches) {
    const result = await patchBranch(branchRow, sessions, cspxCloseByDay);
    console.log(
      `  ${branchRow.branch}: sessions with credit ≠ 0 → ${result.creditSessions}`,
    );
  }

  const live = branches.find((b) => b.branch === "LIVE");
  if (live) {
    const [resolved, latestSnap] = await Promise.all([
      prisma.counterfactual.count({ where: { branchId: live.id, status: "RESOLVED" } }),
      prisma.fitnessSnapshot.findFirst({
        where: { branchId: live.id },
        orderBy: { session: "desc" },
        select: {
          session: true,
          nav: true,
          avoidedCreditDelta: true,
          turnoverDelta: true,
          maxDrawdown: true,
          windowFitness: true,
          openPositions: true,
        },
      }),
    ]);
    console.log(`\nLIVE check:`);
    console.log(`  RESOLVED counterfactuals: ${resolved}`);
    if (latestSnap) {
      console.log(
        `  latest ${ymd(latestSnap.session)}` +
          ` nav=${latestSnap.nav}` +
          ` credit=${latestSnap.avoidedCreditDelta}` +
          ` turnover=${latestSnap.turnoverDelta}` +
          ` dd=${latestSnap.maxDrawdown}` +
          ` window=${latestSnap.windowFitness}` +
          ` open=${latestSnap.openPositions}`,
      );
    }
  }

  console.log(
    dryRun
      ? "\nDry run complete — no writes."
      : "\nDone. Keep EVOLUTION_PROMOTE=0 until you spot-check credits.",
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
