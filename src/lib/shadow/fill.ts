/**
 * `shadow_fill`: fill PENDING paper orders at the NEXT session's OPEN.
 *
 * Invariants enforced in code (not just by convention):
 *  - `fillSession > decisionSession` — an order can never be filled on the bars the
 *    decision was made from (that would be lookahead).
 *  - `fillPrice` is always a `PriceHistory.open`. A missing open is never substituted
 *    with a close or a neighbouring session's price; the order waits, then is rejected.
 *  - Paper cash never goes negative: a buy larger than available cash fills partially.
 *
 * No real-book state (Portfolio / Trade / Config cash) is read or written here.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import { prisma } from "@/lib/prisma";
import { branchBook, ensureShadowBranches, listBranches } from "@/lib/shadow/branches";
import { planBuy, planSell, roundMoney, weightedAvgCost } from "@/lib/shadow/fillMath";
import {
  latestSessionOnOrBeforeIn,
  loadSessions,
  previousSessionBeforeIn,
  sessionDate,
  sessionOffsetIn,
  ymd,
} from "@/lib/shadow/sessions";
import { decToNum } from "@/lib/stocks/format";

/** Sessions an order may wait for a usable open before it is abandoned. */
export const MAX_PENDING_SESSIONS = 3;

/** Stop filling with this much of the tick budget left. */
const BUDGET_HEADROOM_MS = 5_000;

export type ShadowFillDetail = {
  filled: number;
  rejected: number;
  waiting: number;
  byBranch: Record<string, { filled: number; rejected: number; waiting: number }>;
  truncated: boolean;
};

/** The up-to-{@link MAX_PENDING_SESSIONS} sessions after `decisionSession` that elapsed. */
export function eligibleFillSessions(
  sessions: string[],
  decisionSessionDay: string,
  latestSessionDay: string,
): string[] {
  const out: string[] = [];
  for (let n = 1; n <= MAX_PENDING_SESSIONS; n++) {
    const day = sessionOffsetIn(sessions, decisionSessionDay, n);
    if (!day || day > latestSessionDay) break;
    out.push(day);
  }
  return out;
}

async function rejectOrder(orderId: string, reason: string, pendingSessions?: number) {
  await prisma.shadowOrder.update({
    where: { id: orderId },
    data: {
      status: "REJECTED",
      rejectReason: reason,
      ...(pendingSessions === undefined ? {} : { pendingSessions }),
    },
  });
}

async function fillBranch(
  branchRow: { id: string; branch: string },
  sessions: string[],
  runDay: Date,
  budget: JobContext["budget"],
): Promise<{ filled: number; rejected: number; waiting: number; truncated: boolean }> {
  let filled = 0;
  let rejected = 0;
  let waiting = 0;

  const latestSessionDay = latestSessionOnOrBeforeIn(sessions, ymd(runDay));
  const orders = await prisma.shadowOrder.findMany({
    where: { branchId: branchRow.id, status: "PENDING" },
    orderBy: [{ decisionSession: "asc" }, { createdAt: "asc" }],
  });
  if (orders.length === 0 || !latestSessionDay) {
    return { filled, rejected, waiting: orders.length, truncated: false };
  }

  // One bar query for the whole branch instead of a lookup per order.
  const wanted = new Map<string, string[]>();
  for (const order of orders) {
    wanted.set(
      order.id,
      eligibleFillSessions(sessions, ymd(order.decisionSession), latestSessionDay),
    );
  }
  const allDays = [...new Set([...wanted.values()].flat())];
  const bars = allDays.length
    ? await prisma.priceHistory.findMany({
        where: {
          ticker: { in: [...new Set(orders.map((o) => o.ticker))] },
          date: { in: allDays.map(sessionDate) },
          open: { not: null },
        },
        select: { ticker: true, date: true, open: true },
      })
    : [];
  const openByKey = new Map(
    bars.map((b) => [`${b.ticker.trim().toUpperCase()}|${ymd(b.date)}`, decToNum(b.open)]),
  );

  for (const order of orders) {
    if (budget.remainingMs() <= BUDGET_HEADROOM_MS) {
      return { filled, rejected, waiting, truncated: true };
    }

    const decisionSessionDay = ymd(order.decisionSession);
    const candidates = wanted.get(order.id) ?? [];
    if (candidates.length === 0) {
      // The next session has not happened yet — hold, do not count a missed session.
      waiting += 1;
      continue;
    }

    let fillSessionDay: string | null = null;
    let openPrice: number | null = null;
    const orderTicker = order.ticker.trim().toUpperCase();
    for (const day of candidates) {
      const price = openByKey.get(`${orderTicker}|${day}`) ?? null;
      if (price !== null && price > 0) {
        fillSessionDay = day;
        openPrice = price;
        break;
      }
    }

    if (fillSessionDay === null || openPrice === null) {
      const elapsed = candidates.length;
      if (elapsed >= MAX_PENDING_SESSIONS) {
        await rejectOrder(order.id, "no_open_price", elapsed);
        rejected += 1;
      } else {
        await prisma.shadowOrder.update({
          where: { id: order.id },
          data: { pendingSessions: elapsed },
        });
        waiting += 1;
      }
      continue;
    }

    // Hard invariant: never fill on the decision's own session.
    if (!(fillSessionDay > decisionSessionDay)) {
      throw new Error(
        `shadow_fill: fillSession ${fillSessionDay} must be after decisionSession ${decisionSessionDay} (order ${order.id})`,
      );
    }

    const sizeFraction = decToNum(order.sizeFraction) ?? 0;
    const fillSession = sessionDate(fillSessionDay);

    if (order.side === "BUY") {
      // Size against the book valued at the session BEFORE the fill: the fill happens at
      // the OPEN, so the fill session's closes had not printed yet. Valuing at
      // `fillSessionDay` would let that day's move set the notional — lookahead.
      const valuationDay =
        previousSessionBeforeIn(sessions, fillSessionDay) ?? decisionSessionDay;
      const book = await branchBook(branchRow.id, valuationDay);
      const plan = planBuy(sizeFraction * book.nav, book.cash, openPrice);
      if (!plan.ok) {
        await rejectOrder(order.id, plan.reason);
        rejected += 1;
        continue;
      }

      const existing = await prisma.shadowPosition.findFirst({
        where: { branchId: branchRow.id, ticker: order.ticker, closedAt: null },
        select: { id: true, shares: true, avgCost: true },
      });
      const price = openPrice;
      const { notional, shares } = plan;

      await prisma.$transaction(async (tx) => {
        if (existing) {
          const openShares = decToNum(existing.shares) ?? 0;
          const avgCost = weightedAvgCost(
            openShares,
            decToNum(existing.avgCost) ?? price,
            shares,
            price,
          );
          await tx.shadowPosition.update({
            where: { id: existing.id },
            data: { shares: { increment: shares }, avgCost },
          });
        } else {
          await tx.shadowPosition.create({
            data: {
              branchId: branchRow.id,
              ticker: order.ticker,
              openedSession: fillSession,
              shares,
              avgCost: price,
            },
          });
        }
        await tx.shadowBranch.update({
          where: { id: branchRow.id },
          data: { cash: { decrement: notional } },
        });
        await tx.shadowOrder.update({
          where: { id: order.id },
          data: {
            status: "FILLED",
            fillSession,
            fillPrice: price,
            notional,
            shares,
          },
        });
      });
      filled += 1;
      continue;
    }

    // SELL — sizeFraction is the fraction of the OPEN POSITION to liquidate.
    const existing = await prisma.shadowPosition.findFirst({
      where: { branchId: branchRow.id, ticker: order.ticker, closedAt: null },
      select: { id: true, shares: true, avgCost: true, realizedPnl: true },
    });
    if (!existing) {
      await rejectOrder(order.id, "no_position");
      rejected += 1;
      continue;
    }

    const plan = planSell(
      decToNum(existing.shares) ?? 0,
      decToNum(existing.avgCost) ?? 0,
      sizeFraction,
      openPrice,
    );
    if (!plan.ok) {
      await rejectOrder(order.id, plan.reason);
      rejected += 1;
      continue;
    }

    const price = openPrice;
    const priorRealized = decToNum(existing.realizedPnl) ?? 0;
    await prisma.$transaction(async (tx) => {
      await tx.shadowPosition.update({
        where: { id: existing.id },
        data: {
          shares: plan.remainingShares,
          realizedPnl: roundMoney(priorRealized + plan.realizedPnl),
          ...(plan.closes ? { closedAt: new Date(), markStale: false } : {}),
        },
      });
      await tx.shadowBranch.update({
        where: { id: branchRow.id },
        data: { cash: { increment: plan.proceeds } },
      });
      await tx.shadowOrder.update({
        where: { id: order.id },
        data: {
          status: "FILLED",
          fillSession,
          fillPrice: price,
          notional: plan.proceeds,
          shares: plan.sharesSold,
        },
      });
    });
    filled += 1;
  }

  return { filled, rejected, waiting, truncated: false };
}

/**
 * Fill pending orders for both branches (or a caller-supplied subset). Returns
 * `{ done: true }`: the pending set is tiny and every order is re-examined on the next
 * run, so a budget-guard exit loses nothing.
 *
 * `onlyBranchIds` is for the historical replay script — so a LIVE-only re-replay cannot
 * fill stale CANDIDATE orders that were intentionally left alone.
 */
export async function runShadowFill(
  ctx: JobContext,
  opts?: { onlyBranchIds?: string[] },
): Promise<JobResult> {
  await ensureShadowBranches();
  let branches = await listBranches();
  if (opts?.onlyBranchIds) {
    const allow = new Set(opts.onlyBranchIds);
    branches = branches.filter((b) => allow.has(b.id));
  }
  const sessions = await loadSessions();

  const detail: ShadowFillDetail = {
    filled: 0,
    rejected: 0,
    waiting: 0,
    byBranch: {},
    truncated: false,
  };

  for (const branchRow of branches) {
    const result = await fillBranch(branchRow, sessions, ctx.runDay, ctx.budget);
    detail.filled += result.filled;
    detail.rejected += result.rejected;
    detail.waiting += result.waiting;
    detail.truncated ||= result.truncated;
    detail.byBranch[branchRow.branch] = {
      filled: result.filled,
      rejected: result.rejected,
      waiting: result.waiting,
    };
  }

  return { done: true, detail: detail as unknown as Prisma.InputJsonValue };
}
