/**
 * `breadth_classify`: attribute each recent DecisionReview's ticker move to the market,
 * its theme, or the name itself (`classifyMove` in ./math), and persist the inputs.
 *
 * Scope is DecisionReviews created in the last {@link LOOKBACK_DAYS} days with
 * `moveClass: null` — older rows are never classified retroactively, matching the
 * counterfactual seeder's bounded-lookback convention.
 *
 * Reads DecisionReview, PriceHistory (via ./breadth) and — through ./breadth's sanctioned
 * exception — Portfolio.theme / Watchlist.theme. No other book state.
 */
import type { Branch, Prisma } from "@/generated/prisma/client";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import {
  computeBreadthForSession,
  excessMoveOf,
  loadThemeByTicker,
  themeBreadthFor,
  type SessionBreadth,
} from "@/lib/fitness/breadth";
import { classifyMove } from "@/lib/fitness/math";
import { prisma } from "@/lib/prisma";
import { getRuleSet } from "@/lib/rules/resolve";
import { decisionSessionFromEasternDate, easternDateOf, loadSessions } from "@/lib/shadow/sessions";

/** Bounded backward scan; older decisions are never classified retroactively. */
const LOOKBACK_DAYS = 7;

/** Rows examined per run (the daily set is far smaller). */
const MAX_DECISIONS_PER_RUN = 500;

/** Stop working with this much of the tick budget left. */
const BUDGET_HEADROOM_MS = 5_000;

export type BreadthClassifyDetail = {
  classified: number;
  insufficientData: number;
  skipped: number;
  truncated: boolean;
};

/** Fraction of the tracked universe moving the SAME direction as `tickerReturn`. */
function directionalBreadth(
  tickerReturn: number,
  breadthUp: number,
  breadthDown: number,
): number {
  if (tickerReturn > 0) return breadthUp;
  if (tickerReturn < 0) return breadthDown;
  // Flat: no majority direction to have joined.
  return 0;
}

export async function runBreadthClassify(ctx: JobContext): Promise<JobResult> {
  const detail: BreadthClassifyDetail = {
    classified: 0,
    insufficientData: 0,
    skipped: 0,
    truncated: false,
  };

  const since = new Date(ctx.runDay.getTime() - LOOKBACK_DAYS * 86_400_000);
  const decisions = await prisma.decisionReview.findMany({
    where: {
      createdAt: { gte: since },
      moveClass: null,
      ticker: { not: null },
    },
    select: { id: true, ticker: true, branch: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: MAX_DECISIONS_PER_RUN,
  });
  if (decisions.length === 0) return { done: true, detail: detail as unknown as Prisma.InputJsonValue };

  const [sessions, themeOf] = await Promise.all([loadSessions(), loadThemeByTicker()]);

  // One breadth computation per distinct decisionSession, not per decision.
  const breadthBySession = new Map<string, SessionBreadth | null>();
  const ruleSetByBranch = new Map<Branch, Awaited<ReturnType<typeof getRuleSet>>>();

  for (const dr of decisions) {
    if (ctx.budget.remainingMs() <= BUDGET_HEADROOM_MS) {
      detail.truncated = true;
      break;
    }

    const ticker = dr.ticker!.trim().toUpperCase();
    const decisionSessionDay = decisionSessionFromEasternDate(sessions, easternDateOf(dr.createdAt));
    if (!decisionSessionDay) {
      // No session calendar coverage yet for this decision's date — retry next run
      // while it is still inside the lookback window.
      detail.skipped += 1;
      continue;
    }

    if (!breadthBySession.has(decisionSessionDay)) {
      breadthBySession.set(decisionSessionDay, await computeBreadthForSession(decisionSessionDay));
    }
    const sessionBreadth = breadthBySession.get(decisionSessionDay) ?? null;

    if (!sessionBreadth) {
      // Universe sample < MIN_BREADTH_SAMPLE (classifyMove's own floor) — but usually
      // TRANSIENT: a partial price_history failure or the earliest calendar session,
      // repaired by later backfills. Two-phase rule: skip-and-retry (like the sibling
      // skip paths) while the DR still has future runs inside the lookback window;
      // only stamp terminal INSUFFICIENT_DATA on its LAST eligible run — when
      // `createdAt` is more than (LOOKBACK_DAYS − 1) days old — so a genuinely thin
      // session still gets classified instead of aging out unclassified.
      const lastEligibleCutoff = new Date(
        ctx.runDay.getTime() - (LOOKBACK_DAYS - 1) * 86_400_000,
      );
      if (dr.createdAt >= lastEligibleCutoff) {
        detail.skipped += 1;
        continue;
      }
      const updated = await prisma.decisionReview.updateMany({
        where: { id: dr.id, moveClass: null },
        data: {
          moveClass: "INSUFFICIENT_DATA",
          breadth: null,
          themeBreadth: null,
          excessMove: null,
        },
      });
      if (updated.count > 0) detail.insufficientData += 1;
      continue;
    }

    const tickerReturn = sessionBreadth.byTicker.get(ticker);
    if (tickerReturn === undefined) {
      // The ticker itself has no bar at this session yet — retry next run.
      detail.skipped += 1;
      continue;
    }

    if (!ruleSetByBranch.has(dr.branch)) {
      ruleSetByBranch.set(dr.branch, await getRuleSet(dr.branch));
    }
    const limits = ruleSetByBranch.get(dr.branch)!.limits;

    const breadth = directionalBreadth(
      tickerReturn,
      sessionBreadth.breadthUp,
      sessionBreadth.breadthDown,
    );
    // null when the ticker's theme has < 3 other members with a return — stored as null
    // (distinct from "0% of the theme moved with it") but fed to classifyMove as 0, which
    // can never cross themeBreadthThreshold, so it is a safe no-op for the classification.
    const themeBreadthRaw = themeBreadthFor(ticker, sessionBreadth.byTicker, themeOf);
    const excessMove = excessMoveOf(tickerReturn, sessionBreadth.medianReturn);

    // EvidenceItem (tier-1/2 primary-source evidence) lands in a later commit; until then
    // this is always false, so IDIOSYNCRATIC is only ever reached via excessMove here.
    const hasTier12Evidence = false;

    const moveClass = classifyMove({
      breadth,
      themeBreadth: themeBreadthRaw ?? 0,
      excessMove,
      hasTier12Evidence,
      sampleSize: sessionBreadth.sampleSize,
      breadthMarketThreshold: limits.breadthMarketThreshold,
      themeBreadthThreshold: limits.themeBreadthThreshold,
      excessMoveIdiosyncratic: limits.excessMoveIdiosyncratic,
    });

    const updated = await prisma.decisionReview.updateMany({
      where: { id: dr.id, moveClass: null },
      data: { moveClass, breadth, themeBreadth: themeBreadthRaw, excessMove },
    });
    if (updated.count > 0) detail.classified += 1;
  }

  return { done: true, detail: detail as unknown as Prisma.InputJsonValue };
}
