/**
 * `fitness_snapshot`: one row per branch per session recording how that paper book scored.
 *
 * Formula derivation (all terms are FRACTIONS of NAV, never percentage points):
 *
 *   fitnessIncrement = dailyIncrement + avoidedCreditDelta − turnoverDelta − benchmarkIncrement
 *
 *   dailyIncrement      what the book actually made that session (nav / prevNav − 1).
 *   avoidedCreditDelta  Σ SIGNED credits of counterfactuals that resolved since the last
 *                       snapshot. A credit is already permittedSize (a NAV fraction) times
 *                       a return (a fraction), i.e. exactly the NAV move the branch would
 *                       have taken had it acted — so it adds straight onto dailyIncrement
 *                       with no re-normalisation.
 *   turnoverDelta       frictional cost of that session's fills.
 *   benchmarkIncrement  CSPX's session return, SUBTRACTED so a rising tide is not skill.
 *
 * The drawdown penalty is deliberately NOT in the daily term: a drawdown is a property of
 * a PATH, and charging it daily would tax the same decline once per session. It enters at
 * window level instead:
 *
 *   windowFitness = windowReturn(nav) + Σ avoidedCreditDelta − drawdownPenalty(window dd)
 *                   − Σ turnoverDelta − benchmark window return
 *
 * where both Σ run over rows 1..29 of the 30-row window, NOT all 30: windowReturn and the
 * benchmark term span the 29 intervals AFTER row 0's nav, and every term in one sum has to
 * cover the same span or the level is a mix of two different windows.
 *
 * Reads the shadow ledger, Counterfactual and PriceHistory only — no real-book state.
 */
import type { Branch, Prisma } from "@/generated/prisma/client";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import {
  drawdownPenalty,
  maxDrawdown,
  turnoverCost,
  windowReturn,
} from "@/lib/fitness/math";
import { prisma } from "@/lib/prisma";
import { CSPX_TICKER } from "@/lib/pricehistory/symbols";
import { branchBook, ensureShadowBranches, listBranches } from "@/lib/shadow/branches";
import {
  indexOnOrBefore,
  latestSessionOnOrBeforeIn,
  loadSessions,
  sessionDate,
  ymd,
} from "@/lib/shadow/sessions";
import { decToNum } from "@/lib/stocks/format";

/** Sessions in the rolling fitness window. */
export const FITNESS_WINDOW_SESSIONS = 30;

/** Sessions a CSPX close may be carried forward before the benchmark is called missing. */
export const BENCHMARK_CARRY_SESSIONS = 3;

/** Stale-mark share above which a snapshot's evidence is DEGRADED. */
export const STALE_MARK_DEGRADED_RATIO = 0.2;

/** Frictional cost of a fill, as a fraction of its notional. */
const TURNOVER_RATE = 0.001;

export type FitnessSnapshotBranchDetail = {
  session: string;
  nav: number;
  dailyIncrement: number | null;
  avoidedCreditDelta: number;
  benchmarkIncrement: number | null;
  fitnessIncrement: number | null;
  windowFitness: number | null;
  maxDrawdown: number;
  turnoverDelta: number;
  quality: "OK" | "DEGRADED";
};

export type FitnessSnapshotDetail = {
  session: string | null;
  byBranch: Record<string, FitnessSnapshotBranchDetail>;
};

/** Round to the Decimal(10,6) / Decimal(8,6) scale the fraction columns store. */
function roundFraction(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

/**
 * CSPX close at `day`, carried back at most {@link BENCHMARK_CARRY_SESSIONS} sessions.
 *
 * The benchmark is a London-listed ETF: its holiday calendar does not match the US session
 * calendar, so a short carry is honest. Beyond the carry the benchmark is MISSING, and a
 * missing benchmark nulls the fitness term rather than silently scoring an unbenchmarked
 * return as if it were excess.
 */
export function benchmarkCloseAt(
  sessions: string[],
  closeByDay: Map<string, number>,
  day: string,
): number | null {
  const at = indexOnOrBefore(sessions, day);
  if (at === -1) return null;
  for (let back = 0; back <= BENCHMARK_CARRY_SESSIONS; back++) {
    const idx = at - back;
    if (idx < 0) break;
    const close = closeByDay.get(sessions[idx]!);
    if (close !== undefined && close > 0) return close;
  }
  return null;
}

type PriorSnapshot = {
  session: Date;
  nav: number;
  createdAt: Date;
};

async function snapshotBranch(
  branchRow: { id: string; branch: Branch },
  sessionDay: string,
  sessions: string[],
  cspxCloseByDay: Map<string, number>,
): Promise<FitnessSnapshotBranchDetail> {
  const session = sessionDate(sessionDay);

  // resetAt is needed BEFORE the prior-snapshot lookup, so it cannot ride in the batch
  // below: every "since the last snapshot" term must be scoped to the current book.
  const branchMeta = await prisma.shadowBranch.findUnique({
    where: { id: branchRow.id },
    select: { resetAt: true },
  });
  const resetAt = branchMeta?.resetAt ?? null;
  const sinceReset = resetAt ? { createdAt: { gte: resetAt } } : {};

  const [book, existing, priorRow] = await Promise.all([
    branchBook(branchRow.id, sessionDay),
    prisma.fitnessSnapshot.findUnique({
      where: { branchId_session: { branchId: branchRow.id, session } },
      select: { id: true, createdAt: true },
    }),
    // Scoped to the current book exactly as the drawdown/window history below is: after a
    // promotion reset (say 130k → 100k) an unscoped prior would fabricate a −23% daily
    // increment out of a bookkeeping event, and that fake loss would feed sequentialZ
    // straight into a false EARLY_KILL. The first post-reset snapshot has prior = null,
    // so dailyIncrement is null on the fresh book — correct, there is nothing to compare.
    prisma.fitnessSnapshot.findFirst({
      where: { branchId: branchRow.id, session: { lt: session }, ...sinceReset },
      orderBy: { session: "desc" },
      select: { session: true, nav: true, createdAt: true },
    }),
  ]);

  const prior: PriorSnapshot | null = priorRow
    ? {
        session: priorRow.session,
        nav: decToNum(priorRow.nav) ?? 0,
        createdAt: priorRow.createdAt,
      }
    : null;

  const nav = book.nav;
  const dailyIncrement =
    prior && prior.nav > 0 ? roundFraction(nav / prior.nav - 1) : null;

  // Credits are attributed by RESOLUTION TIME, windowed by the previous snapshot's
  // createdAt (exclusive) and this snapshot's own createdAt (inclusive). Re-running the
  // job for the same session therefore recomputes the SAME set — a wall-clock upper bound
  // would let a credit that resolved after this row was first written be counted here on
  // a re-run and again in the next session's snapshot.
  const resolvedCutoff = existing?.createdAt ?? new Date();
  const resolvedCredits = await prisma.counterfactual.findMany({
    where: {
      branchId: branchRow.id,
      status: "RESOLVED",
      credit: { not: null },
      updatedAt: {
        ...(prior ? { gt: prior.createdAt } : {}),
        lte: resolvedCutoff,
      },
    },
    select: { credit: true },
  });
  const avoidedCreditDelta = roundFraction(
    resolvedCredits.reduce((sum, row) => sum + (decToNum(row.credit) ?? 0), 0),
  );

  // Turnover is charged against the NAV the session STARTED with (the previous snapshot's
  // NAV), falling back to today's on the branch's very first snapshot.
  //
  // SPAN CONSISTENCY: dailyIncrement and benchmarkIncrement span from the PREVIOUS SNAPSHOT
  // to this one, which is more than one session whenever the cron skipped days. Charging
  // only `fillSession = session` would silently drop the friction of every gap session
  // while still counting its return — a permanent flattering bias. So every fill in
  // (prior.session, session] is charged here. With no prior (first snapshot of this book)
  // the span opens at the reset, so charge everything filled since resetAt up to session.
  const fills = await prisma.shadowOrder.findMany({
    where: {
      branchId: branchRow.id,
      status: "FILLED",
      fillSession: prior ? { gt: prior.session, lte: session } : { lte: session },
      // An order's updatedAt is stamped when it fills, so it is the fill instant here.
      ...(!prior && resetAt ? { updatedAt: { gte: resetAt } } : {}),
    },
    select: { notional: true },
  });
  const turnoverDelta = turnoverCost(
    fills.map((f) => decToNum(f.notional) ?? 0),
    prior?.nav && prior.nav > 0 ? prior.nav : nav,
    TURNOVER_RATE,
  );

  const benchmarkNow = benchmarkCloseAt(sessions, cspxCloseByDay, sessionDay);
  const benchmarkPrev = prior
    ? benchmarkCloseAt(sessions, cspxCloseByDay, ymd(prior.session))
    : null;
  const benchmarkIncrement =
    benchmarkNow !== null && benchmarkPrev !== null && benchmarkPrev > 0
      ? roundFraction(benchmarkNow / benchmarkPrev - 1)
      : null;

  const fitnessIncrement =
    dailyIncrement === null || benchmarkIncrement === null
      ? null
      : roundFraction(
          dailyIncrement + avoidedCreditDelta - turnoverDelta - benchmarkIncrement,
        );

  // NAV path since the branch's last reset — a promoted ruleset must not inherit the
  // previous one's drawdown.
  const history = await prisma.fitnessSnapshot.findMany({
    where: {
      branchId: branchRow.id,
      session: { lt: session },
      ...sinceReset,
    },
    orderBy: { session: "asc" },
    select: {
      session: true,
      nav: true,
      avoidedCreditDelta: true,
      turnoverDelta: true,
    },
  });
  const navSeries = [...history.map((h) => decToNum(h.nav) ?? 0), nav];
  const branchMaxDrawdown = maxDrawdown(navSeries);

  // Trailing window INCLUDING this session; null until it is actually full.
  const windowRows = [
    ...history.map((h) => ({
      session: ymd(h.session),
      nav: decToNum(h.nav) ?? 0,
      avoidedCreditDelta: decToNum(h.avoidedCreditDelta) ?? 0,
      turnoverDelta: decToNum(h.turnoverDelta) ?? 0,
    })),
    { session: sessionDay, nav, avoidedCreditDelta, turnoverDelta },
  ].slice(-FITNESS_WINDOW_SESSIONS);

  let windowFitness: number | null = null;
  if (windowRows.length >= FITNESS_WINDOW_SESSIONS) {
    const windowStart = windowRows[0]!;
    const benchStart = benchmarkCloseAt(sessions, cspxCloseByDay, windowStart.session);
    if (benchStart !== null && benchStart > 0 && benchmarkNow !== null) {
      const windowNavs = windowRows.map((r) => r.nav);
      // SPAN CONSISTENCY: the return and benchmark terms measure the 29 INTERVALS after
      // windowRows[0] (its nav is the window's opening level, not a move inside it), so
      // the credit and turnover sums must skip row 0 too — its deltas belong to the
      // interval that ended AT the opening level, i.e. to the previous window.
      const spanRows = windowRows.slice(1);
      const credits = spanRows.reduce((sum, r) => sum + r.avoidedCreditDelta, 0);
      const turnover = spanRows.reduce((sum, r) => sum + r.turnoverDelta, 0);
      windowFitness = roundFraction(
        windowReturn(windowNavs) +
          credits -
          drawdownPenalty({ maxDrawdown: maxDrawdown(windowNavs) }) -
          turnover -
          (benchmarkNow / benchStart - 1),
      );
    }
  }

  const openPositions = book.positions.length;
  const staleMarks = book.staleMarks;
  const quality =
    openPositions > 0 && staleMarks / openPositions > STALE_MARK_DEGRADED_RATIO
      ? "DEGRADED"
      : "OK";

  const data = {
    nav,
    dailyIncrement,
    avoidedCreditDelta,
    benchmarkIncrement,
    fitnessIncrement,
    windowFitness,
    maxDrawdown: branchMaxDrawdown,
    turnoverDelta,
    quality,
    staleMarks,
    openPositions,
  } as const;

  // ALIGNMENT INVARIANT: the row's createdAt IS the credit window's upper bound. Letting
  // the DB default stamp it would place the stamp several awaits after `resolvedCutoff`,
  // and a counterfactual resolving in that gap would fall through every window — excluded
  // here by the cutoff, and excluded next session because the lower bound is this row's
  // (later) createdAt. The re-run path already reuses existing.createdAt for the same
  // reason, so on CREATE we write the sampled instant explicitly.
  await prisma.fitnessSnapshot.upsert({
    where: { branchId_session: { branchId: branchRow.id, session } },
    create: { branchId: branchRow.id, session, createdAt: resolvedCutoff, ...data },
    update: data,
  });

  return {
    session: sessionDay,
    nav,
    dailyIncrement,
    avoidedCreditDelta,
    benchmarkIncrement,
    fitnessIncrement,
    windowFitness,
    maxDrawdown: branchMaxDrawdown,
    turnoverDelta,
    quality,
  };
}

export async function runFitnessSnapshot(ctx: JobContext): Promise<JobResult> {
  await ensureShadowBranches();
  const [branches, sessions] = await Promise.all([listBranches(), loadSessions()]);
  const sessionDay = latestSessionOnOrBeforeIn(sessions, ymd(ctx.runDay));

  const detail: FitnessSnapshotDetail = { session: sessionDay, byBranch: {} };
  if (!sessionDay || branches.length === 0) {
    return { done: true, detail: detail as unknown as Prisma.InputJsonValue };
  }

  // One benchmark query for the whole window (plus carry slack), not one per branch.
  // Twice the window because a gap in the cron leaves 30 SNAPSHOTS spanning more than 30
  // sessions; too narrow a range would silently null the window benchmark.
  const at = indexOnOrBefore(sessions, sessionDay);
  const windowStartIdx = Math.max(
    0,
    at - (FITNESS_WINDOW_SESSIONS * 2 + BENCHMARK_CARRY_SESSIONS),
  );
  const from = sessionDate(sessions[windowStartIdx]!);
  const cspxBars = await prisma.priceHistory.findMany({
    where: {
      ticker: CSPX_TICKER,
      date: { gte: from, lte: sessionDate(sessionDay) },
    },
    select: { date: true, close: true },
  });
  const cspxCloseByDay = new Map<string, number>();
  for (const bar of cspxBars) {
    const close = decToNum(bar.close);
    if (close !== null) cspxCloseByDay.set(ymd(bar.date), close);
  }

  for (const branchRow of branches) {
    detail.byBranch[branchRow.branch] = await snapshotBranch(
      branchRow,
      sessionDay,
      sessions,
      cspxCloseByDay,
    );
  }

  return { done: true, detail: detail as unknown as Prisma.InputJsonValue };
}
