/**
 * `counterfactual_resolve`: seed and resolve counterfactuals for decisions NOT taken.
 *
 * A counterfactual asks "what would this refusal have been worth?". It is seeded from
 * AVOID / WAIT / DO_NOT_AVERAGE_DOWN DecisionReviews at the size the branch's OWN ruleset
 * would have permitted, and resolved at each configured horizon (interim 21 + full 63)
 * at that session's close. The resulting credit is SIGNED — see counterfactualCredit.
 *
 * Dual horizons: interim credit enters fitness ~3 weeks after the decision so defensive
 * refusals are not dark for a full quarter; the full-horizon row stores the residual
 * (raw_63 − already-recognized shorter credits) so lifetime sum equals the quarter
 * measure without double-counting.
 *
 * Reads PriceHistory, DecisionReview, the shadow ledger and the branch ruleset only. No
 * Portfolio / Trade / Config state is consulted: a paper book must stay uncontaminated.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { DecisionType } from "@/generated/prisma/client";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import { counterfactualCredit, permittedSize } from "@/lib/fitness/math";
import { prisma } from "@/lib/prisma";
import { getRuleSet } from "@/lib/rules/resolve";
import { branchBook, ensureShadowBranches, listBranches } from "@/lib/shadow/branches";
import { dedupeDecisionsForShadow } from "@/lib/shadow/dedupe";
import {
  decisionSessionForReview,
  latestSessionOnOrBeforeIn,
  loadSessions,
  sessionDate,
  sessionOffsetIn,
  ymd,
} from "@/lib/shadow/sessions";
import { roundFraction } from "@/lib/shadow/sizing";
import { decToNum } from "@/lib/stocks/format";

/** Interim horizon — early signed credit so fitness is not dark for a full quarter. */
export const COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS = 21;

/** Full quarter of trading, counted in SESSIONS so holidays cannot stretch the window. */
export const COUNTERFACTUAL_HORIZON_SESSIONS = 63;

/** Horizons seeded/resolved for every refusal (shortest first). */
export const COUNTERFACTUAL_HORIZONS = [
  COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS,
  COUNTERFACTUAL_HORIZON_SESSIONS,
] as const;

/**
 * Full-horizon rows store residual vs already-recognized shorter credits so lifetime Σ
 * equals the quarter measure without double-counting in fitness.
 */
export function residualCredit(rawFullCredit: number, alreadyRecognized: number): number {
  return roundFraction(rawFullCredit - alreadyRecognized);
}

/** Decision types that represent capital NOT deployed. HOLD is deliberately absent. */
const SEEDABLE_DECISION_TYPES = ["AVOID", "WAIT", "DO_NOT_AVERAGE_DOWN"] as const;

/** Bounded backward scan; older decisions are never seeded retroactively. */
const LOOKBACK_DAYS = 14;

/** Sessions past the exact horizon we will walk forward looking for a usable bar. */
const HORIZON_WALK_SESSIONS = 5;

/** Rows examined per branch per run (the daily set is far smaller). */
const MAX_DECISIONS_PER_BRANCH = 500;
const MAX_PENDING_PER_RUN = 1_000;

/** Stop working with this much of the tick budget left. */
const BUDGET_HEADROOM_MS = 5_000;

export type CounterfactualDetail = {
  seeded: number;
  skipped: number;
  resolved: number;
  unresolved: number;
  byBranch: Record<string, { seeded: number; skipped: number }>;
  truncated: boolean;
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

export type SeedableDecisionRow = {
  id: string;
  ticker: string | null;
  decisionType: DecisionType | null;
  convictionScore: number | null;
  createdAt: Date;
  decisionDate: Date | null;
  notionId: string | null;
  idempotencyKey: string | null;
};

/**
 * Seed counterfactuals for a caller-supplied DR list. Used by the daily cron and by the
 * chronological historical replay script.
 */
export async function seedCounterfactualsForBranch(
  branchRow: { id: string; branch: "LIVE" | "CANDIDATE" },
  sessions: string[],
  decisions: SeedableDecisionRow[],
  runDay: Date,
  budget: JobContext["budget"],
): Promise<{ seeded: number; skipped: number; truncated: boolean }> {
  let seeded = 0;
  let skipped = 0;

  if (decisions.length === 0) return { seeded, skipped, truncated: false };

  // Already-seeded (decision, horizon) pairs are excluded here rather than per decision
  // (no N+1; unique index is the concurrent backstop). notionIds already represented on
  // ANY horizon block twin DR ids from double-crediting the fitness stream.
  const existing = await prisma.counterfactual.findMany({
    where: { branchId: branchRow.id },
    select: { decisionReviewId: true, horizonSessions: true },
  });
  const seededKeys = new Set(
    existing.map((row) => `${row.decisionReviewId}:${row.horizonSessions}`),
  );
  const seededDecisionIds = new Set(existing.map((row) => row.decisionReviewId));
  const seededNotionIds = new Set<string>();
  if (seededDecisionIds.size > 0) {
    const linked = await prisma.decisionReview.findMany({
      where: { id: { in: [...seededDecisionIds] }, notionId: { not: null } },
      select: { notionId: true },
    });
    for (const row of linked) {
      if (row.notionId) seededNotionIds.add(row.notionId);
    }
  }

  const latestSession = latestSessionOnOrBeforeIn(sessions, ymd(runDay));
  if (!latestSession) return { seeded, skipped: decisions.length, truncated: false };

  const [book, ruleSet] = await Promise.all([
    branchBook(branchRow.id, latestSession),
    getRuleSet(branchRow.branch),
  ]);

  // Open shadow weights: the DNAD sizer needs the position it declined to add to, and
  // the WAIT double-count guard needs to know the branch already owns the name.
  const weightByTicker = new Map<string, number>();
  for (const position of book.positions) {
    const value = position.mark === null ? 0 : position.shares * position.mark;
    weightByTicker.set(position.ticker, book.nav > 0 ? value / book.nav : 0);
  }

  // A decision already seeded on any horizon still needs missing horizons filled in;
  // only twin notionIds (a different DR id for the same refusal) are hard-skipped.
  const pending = decisions.filter((d) => {
    const missingHorizon = COUNTERFACTUAL_HORIZONS.some(
      (h) => !seededKeys.has(`${d.id}:${h}`),
    );
    if (!missingHorizon) return false;
    if (d.notionId && seededNotionIds.has(d.notionId) && !seededDecisionIds.has(d.id)) {
      return false;
    }
    return true;
  });
  const decisionSessionById = new Map<string, string>();
  for (const dr of pending) {
    const day = decisionSessionForReview(sessions, dr);
    if (day) decisionSessionById.set(dr.id, day);
  }

  // One bar query for the whole branch's batch.
  const wantedDays = [...new Set([...decisionSessionById.values()])];
  const tickers = [...new Set(pending.map((d) => d.ticker!.trim().toUpperCase()))];
  const bars =
    wantedDays.length && tickers.length
      ? await prisma.priceHistory.findMany({
          where: {
            ticker: { in: tickers },
            date: { in: wantedDays.map(sessionDate) },
          },
          select: { ticker: true, date: true, close: true },
        })
      : [];
  const closeByKey = new Map(
    bars.map((b) => [`${b.ticker.trim().toUpperCase()}|${ymd(b.date)}`, decToNum(b.close)]),
  );

  for (const dr of pending) {
    if (budget.remainingMs() <= BUDGET_HEADROOM_MS) {
      return { seeded, skipped, truncated: true };
    }

    const ticker = dr.ticker!.trim().toUpperCase();
    const decisionType = dr.decisionType!;
    const heldWeight = weightByTicker.get(ticker) ?? 0;

    // WAIT on a name the branch ALREADY HOLDS is a HOLD, not a refusal to deploy: the
    // position's own P&L is already in NAV, so crediting it again would double-count the
    // same price move (once in the book, once as avoided loss). No counterfactual.
    if (decisionType === "WAIT" && weightByTicker.has(ticker)) {
      skipped += 1;
      continue;
    }

    const decisionSessionDay = decisionSessionById.get(dr.id);
    if (!decisionSessionDay) {
      skipped += 1;
      continue;
    }

    const priceAtDecision = closeByKey.get(`${ticker}|${decisionSessionDay}`) ?? null;
    if (priceAtDecision === null || priceAtDecision <= 0) {
      // No bar for that session yet — left unseeded on purpose; the next run re-selects
      // this DR while it is still inside the lookback window.
      skipped += 1;
      continue;
    }

    const size = permittedSize({
      limits: ruleSet.limits,
      decisionType,
      conviction: dr.convictionScore,
      // Sleeve is unknown here: DecisionReview does not carry one and the sleeve lives on
      // the REAL book, which the shadow ledger must not read. The sleeve cap therefore
      // only ever tightens sizes when a caller can supply it.
      sleeve: null,
      currentWeight: heldWeight,
    });

    for (const horizonSessions of COUNTERFACTUAL_HORIZONS) {
      if (seededKeys.has(`${dr.id}:${horizonSessions}`)) continue;
      try {
        await prisma.counterfactual.create({
          data: {
            branchId: branchRow.id,
            decisionReviewId: dr.id,
            ticker,
            decisionType,
            decisionSession: sessionDate(decisionSessionDay),
            horizonSessions,
            priceAtDecision,
            permittedSize: size,
            status: "PENDING",
          },
        });
        seededKeys.add(`${dr.id}:${horizonSessions}`);
        seededDecisionIds.add(dr.id);
        if (dr.notionId) seededNotionIds.add(dr.notionId);
        seeded += 1;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
  }

  return { seeded, skipped, truncated: false };
}

async function seedForBranch(
  branchRow: { id: string; branch: "LIVE" | "CANDIDATE" },
  sessions: string[],
  runDay: Date,
  budget: JobContext["budget"],
): Promise<{ seeded: number; skipped: number; truncated: boolean }> {
  const since = new Date(runDay.getTime() - LOOKBACK_DAYS * 86_400_000);
  const raw = await prisma.decisionReview.findMany({
    where: {
      branch: branchRow.branch,
      createdAt: { gte: since },
      ticker: { not: null },
      decisionType: { in: [...SEEDABLE_DECISION_TYPES] },
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
    },
    orderBy: [{ decisionDate: "asc" }, { createdAt: "asc" }],
    take: MAX_DECISIONS_PER_BRANCH,
  });

  return seedCounterfactualsForBranch(
    branchRow,
    sessions,
    dedupeDecisionsForShadow(raw),
    runDay,
    budget,
  );
}

/** Ascending sessions to try for the horizon price: the exact one, then the walk. */
export function horizonCandidateSessions(
  sessions: string[],
  decisionSessionDay: string,
  horizonSessions: number,
  latestSessionDay: string,
): { horizonDay: string | null; candidates: string[] } {
  const horizonDay = sessionOffsetIn(sessions, decisionSessionDay, horizonSessions);
  if (!horizonDay || horizonDay > latestSessionDay) {
    return { horizonDay: null, candidates: [] };
  }
  const candidates = [horizonDay];
  for (let n = 1; n <= HORIZON_WALK_SESSIONS; n++) {
    const day = sessionOffsetIn(sessions, decisionSessionDay, horizonSessions + n);
    if (!day || day > latestSessionDay) break;
    candidates.push(day);
  }
  return { horizonDay, candidates };
}

/** Resolve PENDING counterfactuals whose horizon has elapsed as of `runDay`. */
export async function resolvePendingCounterfactuals(
  sessions: string[],
  runDay: Date,
  budget: JobContext["budget"],
): Promise<{ resolved: number; unresolved: number; truncated: boolean }> {
  let resolved = 0;
  let unresolved = 0;

  const latestSessionDay = latestSessionOnOrBeforeIn(sessions, ymd(runDay));
  if (!latestSessionDay) return { resolved, unresolved, truncated: false };

  const rows = await prisma.counterfactual.findMany({
    where: { status: "PENDING" },
    // Shorter horizons first: if 21 and 63 both elapse in the same run, interim must
    // resolve before full computes its residual — otherwise full stores raw_63 and
    // interim later adds raw_21 → double-count in fitness.
    orderBy: [{ decisionSession: "asc" }, { horizonSessions: "asc" }],
    take: MAX_PENDING_PER_RUN,
  });
  if (rows.length === 0) return { resolved, unresolved, truncated: false };

  const plans = new Map<string, { horizonDay: string | null; candidates: string[] }>();
  for (const row of rows) {
    plans.set(
      row.id,
      horizonCandidateSessions(
        sessions,
        ymd(row.decisionSession),
        row.horizonSessions,
        latestSessionDay,
      ),
    );
  }

  const allDays = [...new Set([...plans.values()].flatMap((p) => p.candidates))];
  const bars = allDays.length
    ? await prisma.priceHistory.findMany({
        where: {
          ticker: { in: [...new Set(rows.map((r) => r.ticker))] },
          date: { in: allDays.map(sessionDate) },
        },
        select: { ticker: true, date: true, close: true },
      })
    : [];
  const closeByKey = new Map(
    bars.map((b) => [`${b.ticker.trim().toUpperCase()}|${ymd(b.date)}`, decToNum(b.close)]),
  );

  for (const row of rows) {
    if (budget.remainingMs() <= BUDGET_HEADROOM_MS) {
      return { resolved, unresolved, truncated: true };
    }

    const plan = plans.get(row.id)!;
    // Horizon has not elapsed yet (or the calendar does not reach it) — stay PENDING.
    if (!plan.horizonDay) continue;

    // Belt-and-suspenders: never resolve a longer horizon while a shorter sibling is
    // still PENDING (e.g. prior run truncated after seeding both).
    if (row.horizonSessions > COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS) {
      const pendingShorter = await prisma.counterfactual.count({
        where: {
          branchId: row.branchId,
          decisionReviewId: row.decisionReviewId,
          horizonSessions: { lt: row.horizonSessions },
          status: "PENDING",
        },
      });
      if (pendingShorter > 0) continue;
    }

    const ticker = row.ticker.trim().toUpperCase();
    let priced: { day: string; close: number } | null = null;
    for (const day of plan.candidates) {
      const close = closeByKey.get(`${ticker}|${day}`) ?? null;
      if (close !== null && close > 0) {
        priced = { day, close };
        break;
      }
    }

    if (!priced) {
      // Only give up once the whole walk has actually elapsed; otherwise wait for it.
      const walkElapsed = plan.candidates.length > HORIZON_WALK_SESSIONS;
      if (!walkElapsed) continue;
      await prisma.counterfactual.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: "UNRESOLVED", horizonSession: sessionDate(plan.horizonDay) },
      });
      unresolved += 1;
      continue;
    }

    const priceAtDecision = decToNum(row.priceAtDecision);
    const size = decToNum(row.permittedSize) ?? 0;
    if (priceAtDecision === null || priceAtDecision <= 0) {
      // Unsalvageable seed row: never credit off a bad decision price.
      await prisma.counterfactual.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: "UNRESOLVED", horizonSession: sessionDate(plan.horizonDay) },
      });
      unresolved += 1;
      continue;
    }

    const { horizonReturn, credit: rawCredit } = counterfactualCredit({
      priceAtDecision,
      priceAtHorizon: priced.close,
      permittedSize: size,
    });

    // Full-horizon rows store the residual vs shorter horizons already recognized in
    // fitness, so Σ credits over a decision's life equals the quarter measure once.
    let credit = rawCredit;
    if (row.horizonSessions > COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS) {
      const shorter = await prisma.counterfactual.findMany({
        where: {
          branchId: row.branchId,
          decisionReviewId: row.decisionReviewId,
          horizonSessions: { lt: row.horizonSessions },
          status: "RESOLVED",
          credit: { not: null },
        },
        select: { credit: true },
      });
      const already = shorter.reduce((sum, s) => sum + (decToNum(s.credit) ?? 0), 0);
      credit = residualCredit(rawCredit, already);
    }

    // Conditioned on status so a concurrent run cannot resolve the same row twice.
    const updated = await prisma.counterfactual.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: {
        status: "RESOLVED",
        // The session actually priced — may be inside the forward walk, never before it.
        horizonSession: sessionDate(priced.day),
        priceAtHorizon: priced.close,
        horizonReturn,
        credit,
      },
    });
    if (updated.count > 0) resolved += 1;
  }

  return { resolved, unresolved, truncated: false };
}

/**
 * Seed then resolve. Both halves are idempotent (unique key on seed, status-conditioned
 * updates on resolve), so the job returns `{ done: true }` and relies on the next run to
 * pick up anything the budget guard cut short.
 */
export async function runCounterfactuals(ctx: JobContext): Promise<JobResult> {
  await ensureShadowBranches();
  const [branches, sessions] = await Promise.all([listBranches(), loadSessions()]);

  const detail: CounterfactualDetail = {
    seeded: 0,
    skipped: 0,
    resolved: 0,
    unresolved: 0,
    byBranch: {},
    truncated: false,
  };

  for (const branchRow of branches) {
    const result = await seedForBranch(branchRow, sessions, ctx.runDay, ctx.budget);
    detail.seeded += result.seeded;
    detail.skipped += result.skipped;
    detail.truncated ||= result.truncated;
    detail.byBranch[branchRow.branch] = {
      seeded: result.seeded,
      skipped: result.skipped,
    };
  }

  const resolution = await resolvePendingCounterfactuals(sessions, ctx.runDay, ctx.budget);
  detail.resolved = resolution.resolved;
  detail.unresolved = resolution.unresolved;
  detail.truncated ||= resolution.truncated;

  return { done: true, detail: detail as unknown as Prisma.InputJsonValue };
}
