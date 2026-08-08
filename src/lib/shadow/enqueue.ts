/**
 * `shadow_enqueue`: turn DecisionReview rows into PENDING paper orders.
 *
 * A DR row's own `branch` column decides which paper book it belongs to. Each DR can
 * enqueue at most one order per side per branch (DB unique index is the backstop), so a
 * replayed routine cannot double-size the book. Nothing here reads the real book.
 *
 * Runs AFTER `shadow_fill` (see the cron registry) so yesterday's orders are resolved
 * before today's decisions are judged. Orders still PENDING at this point are exposure
 * the branch has already committed to, so they count towards position sizing and they
 * defer — never reject — a sell for the same ticker.
 *
 * `decisionSession` prefers DR.`decisionDate` (calendar ymd) over Eastern `createdAt`,
 * so Notion-backfilled history is not collapsed onto the sync day.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Branch, DecisionType } from "@/generated/prisma/client";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import { prisma } from "@/lib/prisma";
import { getRuleSet } from "@/lib/rules/resolve";
import { branchBook, ensureShadowBranches, listBranches } from "@/lib/shadow/branches";
import { dedupeDecisionsForShadow } from "@/lib/shadow/dedupe";
import { classifyDecisionType, sellDisposition } from "@/lib/shadow/orders";
import {
  decisionSessionForReview,
  loadSessions,
  latestSessionOnOrBeforeIn,
  sessionDate,
  ymd,
} from "@/lib/shadow/sessions";
import { buySizeFraction, sellSizeFraction } from "@/lib/shadow/sizing";
import { decToNum } from "@/lib/stocks/format";

/** Bounded backward scan — older decisions are never enqueued retroactively by the cron. */
const LOOKBACK_DAYS = 14;

/** Hard cap on DR rows examined per branch per run (the daily set is far smaller). */
const MAX_DECISIONS_PER_BRANCH = 500;

/** Stop enqueuing with this much of the tick budget left. */
const BUDGET_HEADROOM_MS = 5_000;

type BranchCounts = {
  enqueued: number;
  rejected: number;
  skipped: number;
  /** Sells held back until a pending BUY for the same ticker resolves (see below). */
  deferred: number;
};

export type ShadowEnqueueDetail = BranchCounts & {
  byBranch: Record<string, BranchCounts>;
  /** True when the budget guard stopped the scan; the rest is picked up next tick/day. */
  truncated: boolean;
};

export type EnqueueDecisionRow = {
  id: string;
  ticker: string | null;
  decisionType: DecisionType | null;
  convictionScore: number | null;
  createdAt: Date;
  decisionDate: Date | null;
  notionId: string | null;
  idempotencyKey: string | null;
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

/**
 * Enqueue a caller-supplied DR list (already scoped to a branch). Used by the daily cron
 * and by the chronological historical replay script.
 */
export async function enqueueDecisionsForBranch(
  branchRow: { id: string; branch: Branch },
  sessions: string[],
  decisions: EnqueueDecisionRow[],
  runDay: Date,
  budget: JobContext["budget"],
): Promise<BranchCounts & { truncated: boolean }> {
  let enqueued = 0;
  let rejected = 0;
  let skipped = 0;
  let deferred = 0;

  if (decisions.length === 0) {
    return { enqueued, rejected, skipped, deferred, truncated: false };
  }

  // Book valued at the latest session — the weights the sizer clamps against.
  const latestSession = latestSessionOnOrBeforeIn(sessions, ymd(runDay));
  if (!latestSession) {
    return { enqueued, rejected, skipped: decisions.length, deferred, truncated: false };
  }
  const [book, ruleSet, pendingOrders] = await Promise.all([
    branchBook(branchRow.id, latestSession),
    getRuleSet(branchRow.branch),
    prisma.shadowOrder.findMany({
      where: { branchId: branchRow.id, status: "PENDING", side: "BUY" },
      select: { ticker: true, sizeFraction: true },
    }),
  ]);

  const openByTicker = new Map(book.positions.map((p) => [p.ticker, p]));
  const pendingBuyTickers = new Set(pendingOrders.map((o) => o.ticker));
  // Running weights: several decisions for the same ticker in one run must see each
  // other's sizing, otherwise a BUY+ADD pair could each claim the full cap headroom.
  const claimedFraction = new Map<string, number>();
  for (const p of book.positions) {
    const value = p.mark === null ? 0 : p.shares * p.mark;
    claimedFraction.set(p.ticker, book.nav > 0 ? value / book.nav : 0);
  }
  // A PENDING BUY is exposure already claimed: leaving it out would let a next-day ADD
  // size against a book that does not yet show the first buy, breaching singlePositionPct
  // once both fill.
  for (const order of pendingOrders) {
    const fraction = decToNum(order.sizeFraction) ?? 0;
    claimedFraction.set(order.ticker, (claimedFraction.get(order.ticker) ?? 0) + fraction);
  }

  for (const dr of decisions) {
    if (budget.remainingMs() <= BUDGET_HEADROOM_MS) {
      return { enqueued, rejected, skipped, deferred, truncated: true };
    }

    const ticker = dr.ticker!.trim().toUpperCase();
    const intent = classifyDecisionType(dr.decisionType);
    if (intent.kind === "none") {
      skipped += 1;
      continue;
    }

    const decisionSessionDay = decisionSessionForReview(sessions, dr);
    if (!decisionSessionDay) {
      // No session on/before the decision date — cannot date the order deterministically.
      skipped += 1;
      continue;
    }

    const base: Prisma.ShadowOrderUncheckedCreateInput = {
      branchId: branchRow.id,
      ticker,
      side: intent.kind === "buy" ? "BUY" : "SELL",
      decisionType: dr.decisionType,
      decisionReviewId: dr.id,
      decisionSession: sessionDate(decisionSessionDay),
      sizeFraction: 0,
    };

    if (intent.kind === "buy") {
      const sizing = buySizeFraction(
        dr.convictionScore,
        claimedFraction.get(ticker) ?? 0,
        ruleSet.limits,
      );
      if (!sizing.ok) {
        try {
          await prisma.shadowOrder.create({
            data: { ...base, status: "REJECTED", rejectReason: sizing.reason },
          });
          rejected += 1;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
        continue;
      }
      try {
        await prisma.shadowOrder.create({
          data: { ...base, sizeFraction: sizing.sizeFraction },
        });
        enqueued += 1;
        claimedFraction.set(ticker, (claimedFraction.get(ticker) ?? 0) + sizing.sizeFraction);
        // Same-run sells for this ticker must defer (not reject no_position) once a BUY is
        // pending — the book will not show the position until the next session's fill.
        pendingBuyTickers.add(ticker);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      continue;
    }

    const open = openByTicker.get(ticker);
    const disposition = sellDisposition(open?.shares ?? 0, pendingBuyTickers.has(ticker));
    if (disposition === "defer") {
      // Left un-enqueued on purpose: the next run re-selects this DR (it is still inside
      // the lookback and still has no order) and decides again once the BUY resolves.
      deferred += 1;
      continue;
    }
    if (disposition === "reject_no_position") {
      try {
        await prisma.shadowOrder.create({
          data: { ...base, status: "REJECTED", rejectReason: "no_position" },
        });
        rejected += 1;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      continue;
    }
    try {
      await prisma.shadowOrder.create({
        data: { ...base, sizeFraction: sellSizeFraction(intent.portion) },
      });
      enqueued += 1;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }

  return { enqueued, rejected, skipped, deferred, truncated: false };
}

async function enqueueForBranch(
  branchRow: { id: string; branch: Branch },
  sessions: string[],
  runDay: Date,
  budget: JobContext["budget"],
): Promise<BranchCounts & { truncated: boolean }> {
  const since = new Date(runDay.getTime() - LOOKBACK_DAYS * 86_400_000);

  // Already-enqueued DRs (any age) — unique index is the backstop, but we also collect
  // notionIds already represented so a twin DR id cannot double-enter the book.
  const enqueuedRows = await prisma.shadowOrder.findMany({
    where: {
      branchId: branchRow.id,
      decisionReviewId: { not: null },
    },
    select: { decisionReviewId: true },
  });
  const enqueuedIds = new Set(
    enqueuedRows
      .map((o) => o.decisionReviewId)
      .filter((id): id is string => id !== null),
  );
  const enqueuedNotionIds = new Set<string>();
  if (enqueuedIds.size > 0) {
    const linked = await prisma.decisionReview.findMany({
      where: { id: { in: [...enqueuedIds] }, notionId: { not: null } },
      select: { notionId: true },
    });
    for (const row of linked) {
      if (row.notionId) enqueuedNotionIds.add(row.notionId);
    }
  }

  const raw = await prisma.decisionReview.findMany({
    where: {
      branch: branchRow.branch,
      createdAt: { gte: since },
      ticker: { not: null },
      decisionType: { in: ["BUY", "ADD", "AVERAGE_DOWN", "REDUCE", "EXIT"] },
      ...(enqueuedIds.size > 0 ? { id: { notIn: [...enqueuedIds] } } : {}),
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

  const decisions = dedupeDecisionsForShadow(raw).filter(
    (d) => !d.notionId || !enqueuedNotionIds.has(d.notionId),
  );

  return enqueueDecisionsForBranch(branchRow, sessions, decisions, runDay, budget);
}

/**
 * Enqueue paper orders for both branches. Resumability: the set is small and bounded
 * (a fortnight of decisions), so the job returns `{ done: true }` and relies on its own
 * idempotency — anything cut short by the budget guard is re-scanned on the next run
 * because it is still un-enqueued and still inside the lookback window.
 */
export async function runShadowEnqueue(ctx: JobContext): Promise<JobResult> {
  await ensureShadowBranches();
  const branches = await listBranches();
  if (branches.length === 0) {
    return {
      done: true,
      detail: {
        enqueued: 0,
        rejected: 0,
        skipped: 0,
        deferred: 0,
        byBranch: {},
        truncated: false,
      },
    };
  }

  const sessions = await loadSessions();
  const detail: ShadowEnqueueDetail = {
    enqueued: 0,
    rejected: 0,
    skipped: 0,
    deferred: 0,
    byBranch: {},
    truncated: false,
  };

  for (const branchRow of branches) {
    const result = await enqueueForBranch(branchRow, sessions, ctx.runDay, ctx.budget);
    detail.enqueued += result.enqueued;
    detail.rejected += result.rejected;
    detail.skipped += result.skipped;
    detail.deferred += result.deferred;
    detail.truncated ||= result.truncated;
    detail.byBranch[branchRow.branch] = {
      enqueued: result.enqueued,
      rejected: result.rejected,
      skipped: result.skipped,
      deferred: result.deferred,
    };
  }

  return { done: true, detail: detail as unknown as Prisma.InputJsonValue };
}
