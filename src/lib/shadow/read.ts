/**
 * Read-only views of the paper books for the agent surface (MCP + HTTP).
 * Reads ShadowBranch / ShadowPosition / ShadowOrder only — no real-book state.
 */
import type { Branch, ShadowOrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { roundMoney } from "@/lib/shadow/fillMath";
import { decToNum } from "@/lib/stocks/format";

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function day(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export type ListShadowPositionsInput = {
  branch?: Branch;
  includeClosed?: boolean;
};

export async function listShadowPositions(input: ListShadowPositionsInput = {}) {
  const branch = input.branch ?? "LIVE";
  const branchRow = await prisma.shadowBranch.findUnique({
    where: { branch },
    select: { id: true },
  });
  if (!branchRow) return { branch, positions: [] };

  const rows = await prisma.shadowPosition.findMany({
    where: {
      branchId: branchRow.id,
      ...(input.includeClosed ? {} : { closedAt: null }),
    },
    orderBy: [{ closedAt: "asc" }, { ticker: "asc" }],
  });

  return {
    branch,
    positions: rows.map((p) => {
      const shares = decToNum(p.shares) ?? 0;
      const mark = decToNum(p.lastMark);
      return {
        id: p.id,
        ticker: p.ticker,
        openedSession: day(p.openedSession),
        closedAt: iso(p.closedAt),
        shares,
        avgCost: decToNum(p.avgCost),
        lastMark: mark,
        lastMarkSession: day(p.lastMarkSession),
        markStale: p.markStale,
        marketValue: mark === null ? null : roundMoney(shares * mark),
        realizedPnl: decToNum(p.realizedPnl),
      };
    }),
  };
}

export type ListShadowOrdersInput = {
  branch?: Branch;
  status?: ShadowOrderStatus;
  limit?: number;
};

export async function listShadowOrders(input: ListShadowOrdersInput = {}) {
  const branch = input.branch ?? "LIVE";
  const limit = Math.min(input.limit ?? 50, 200);
  const branchRow = await prisma.shadowBranch.findUnique({
    where: { branch },
    select: { id: true },
  });
  if (!branchRow) return { branch, orders: [] };

  const rows = await prisma.shadowOrder.findMany({
    where: { branchId: branchRow.id, ...(input.status ? { status: input.status } : {}) },
    orderBy: [{ decisionSession: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return {
    branch,
    orders: rows.map((o) => ({
      id: o.id,
      ticker: o.ticker,
      side: o.side,
      status: o.status,
      decisionType: o.decisionType,
      decisionReviewId: o.decisionReviewId,
      decisionSession: day(o.decisionSession),
      sizeFraction: decToNum(o.sizeFraction),
      fillSession: day(o.fillSession),
      fillPrice: decToNum(o.fillPrice),
      notional: decToNum(o.notional),
      shares: decToNum(o.shares),
      rejectReason: o.rejectReason,
      pendingSessions: o.pendingSessions,
      createdAt: iso(o.createdAt),
    })),
  };
}

export type ShadowContextBlock = {
  branch: Branch;
  nav: number;
  cash: number;
  openPositions: number;
  lastMarkSession: string | null;
};

/**
 * Informational shadow summary for `get_context`. Valued off each position's carried
 * `lastMark` (set nightly by `shadow_mark`) so this stays two small queries — it is a
 * status readout, not the accounting path. Null when the branch is not seeded yet.
 */
export async function shadowContextBlock(
  branch: Branch,
): Promise<ShadowContextBlock | null> {
  const branchRow = await prisma.shadowBranch.findUnique({
    where: { branch },
    select: { id: true, cash: true },
  });
  if (!branchRow) return null;

  const positions = await prisma.shadowPosition.findMany({
    where: { branchId: branchRow.id, closedAt: null },
    select: { shares: true, lastMark: true, lastMarkSession: true },
  });

  const cash = decToNum(branchRow.cash) ?? 0;
  let equity = 0;
  let lastMarkSession: Date | null = null;
  for (const p of positions) {
    const mark = decToNum(p.lastMark);
    if (mark !== null) equity += (decToNum(p.shares) ?? 0) * mark;
    if (p.lastMarkSession && (!lastMarkSession || p.lastMarkSession > lastMarkSession)) {
      lastMarkSession = p.lastMarkSession;
    }
  }

  return {
    branch,
    nav: roundMoney(cash + equity),
    cash: roundMoney(cash),
    openPositions: positions.length,
    lastMarkSession: day(lastMarkSession),
  };
}
