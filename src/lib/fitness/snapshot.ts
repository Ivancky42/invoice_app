/**
 * `fitness_snapshot`: one row per branch per session recording how that paper book scored.
 *
 * Formula derivation (all terms are FRACTIONS of NAV, never percentage points):
 *
 *   fitnessIncrement = dailyIncrement + avoidedCreditDelta − turnoverDelta − benchmarkIncrement
 *
 *   dailyIncrement      what the book actually made that session (nav / prevNav − 1).
 *   avoidedCreditDelta  Σ SIGNED credits of counterfactuals whose horizonSession falls in
 *                       (prior.session, session]. A credit is already permittedSize (a NAV
 *                       fraction) times a return (a fraction). Logical session attribution
 *                       (not wall-clock resolve time) so replay/backfill and daily cron agree.
 *   turnoverDelta       frictional cost of that session's fills (commission/hyperactivity
 *                       tax on Σ|notional| / startNav). Separate from fill-path slippage,
 *                       which already worsens cash/avgCost in the paper book.
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
 * `maxDrawdown` on the row is the rolling peak-to-trough over the same trailing window
 * (or the available history until the window is full) — not a lifetime high-water mark.
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

/** Frictional fitness tax on a fill, as a fraction of its notional (10 bps). */
export const TURNOVER_RATE = 0.001;

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
 * True when an existing snapshot's book-derived fields must be kept.
 * Historical re-snaps must not re-mark today's open positions at an old close.
 */
export function shouldPreserveBookFields(
  sessionDay: string,
  calendarTip: string,
  hasExisting: boolean,
): boolean {
  return hasExisting && sessionDay < calendarTip;
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
};

async function snapshotBranch(
  branchRow: { id: string; branch: Branch },
  sessionDay: string,
  sessions: string[],
  cspxCloseByDay: Map<string, number>,
): Promise<FitnessSnapshotBranchDetail> {
  const session = sessionDate(sessionDay);
  // Calendar tip: anything strictly before this is historical. Re-snapping a historical
  // session via branchBook would mark TODAY's open positions at THAT day's closes and
  // overwrite the true path — the bug that corrupted prod during a naive rebuild.
  const calendarTip = sessions[sessions.length - 1] ?? sessionDay;

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
      select: {
        nav: true,
        dailyIncrement: true,
        openPositions: true,
        staleMarks: true,
        quality: true,
      },
    }),
    // Scoped to the current book exactly as the drawdown/window history below is: after a
    // promotion reset (say 130k → 100k) an unscoped prior would fabricate a −23% daily
    // increment out of a bookkeeping event, and that fake loss would feed sequentialZ
    // straight into a false EARLY_KILL. The first post-reset snapshot has prior = null,
    // so dailyIncrement is null on the fresh book — correct, there is nothing to compare.
    prisma.fitnessSnapshot.findFirst({
      where: { branchId: branchRow.id, session: { lt: session }, ...sinceReset },
      orderBy: { session: "desc" },
      select: { session: true, nav: true },
    }),
  ]);

  const prior: PriorSnapshot | null = priorRow
    ? {
        session: priorRow.session,
        nav: decToNum(priorRow.nav) ?? 0,
      }
    : null;

  // Preserve book-derived fields on historical re-runs. Create path (replay after wipe)
  // and the calendar-tip session (daily cron) still take a fresh mark from branchBook.
  const preserveBook = shouldPreserveBookFields(
    sessionDay,
    calendarTip,
    existing != null,
  );
  const stored = preserveBook ? existing! : null;
  const nav = stored ? (decToNum(stored.nav) ?? 0) : book.nav;
  const dailyIncrement = stored
    ? decToNum(stored.dailyIncrement)
    : prior && prior.nav > 0
      ? roundFraction(nav / prior.nav - 1)
      : null;

  // Credits are attributed by LOGICAL horizon session (when the refusal's window elapsed),
  // not wall-clock resolve time. Wall-clock windows broke historical replay/backfill:
  // resolve-at-end stamped every credit after every snapshot's createdAt, so
  // avoidedCreditDelta stayed 0 forever. horizonSession span is idempotent under re-run
  // and matches the same (prior.session, session] gap-fill rule as turnover.
  // Tenure isolation: resetBranch deleteMany's CFs before stamping resetAt. Do not also
  // filter createdAt >= resetAt — app-clock resetAt vs DB createdAt skew can drop a
  // valid post-reset credit on the first snapshot.
  const resolvedCredits = await prisma.counterfactual.findMany({
    where: {
      branchId: branchRow.id,
      status: "RESOLVED",
      credit: { not: null },
      horizonSession: prior
        ? { gt: prior.session, lte: session }
        : { lte: session },
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
  // Rolling window peak-to-trough of the REALIZED paper NAV path only. Counterfactual
  // credits are a flat additive term and do not deepen this drawdown — a refused volatile
  // add is debited for return without a matching risk penalty. That gap is deliberate for
  // now (kernel fitness uses shadow DD); do not fold CF notionals into navSeries here.
  const rollingNavs = navSeries.slice(-FITNESS_WINDOW_SESSIONS);
  const branchMaxDrawdown = maxDrawdown(rollingNavs);

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

  const openPositions = stored ? stored.openPositions : book.positions.length;
  const staleMarks = stored ? stored.staleMarks : book.staleMarks;
  const quality = stored
    ? stored.quality
    : openPositions > 0 && staleMarks / openPositions > STALE_MARK_DEGRADED_RATIO
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

  await prisma.fitnessSnapshot.upsert({
    where: { branchId_session: { branchId: branchRow.id, session } },
    create: { branchId: branchRow.id, session, ...data },
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

export async function runFitnessSnapshot(
  ctx: JobContext,
  opts?: { onlyBranchIds?: string[] },
): Promise<JobResult> {
  await ensureShadowBranches();
  const [allBranches, sessions] = await Promise.all([listBranches(), loadSessions()]);
  const branches = opts?.onlyBranchIds
    ? allBranches.filter((b) => opts.onlyBranchIds!.includes(b.id))
    : allBranches;
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
