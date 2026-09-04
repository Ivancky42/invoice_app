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

/**
 * Open paper tickers for a branch. Missing ShadowBranch → empty set (unseeded
 * book), never throws — callers treat that as "no positions".
 */
export async function openPaperTickers(branch: Branch): Promise<Set<string>> {
  try {
    const listed = await listShadowPositions({ branch, includeClosed: false });
    return new Set(listed.positions.map((p) => p.ticker.trim().toUpperCase()));
  } catch {
    return new Set();
  }
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

export type PaperBookPositionForContext = {
  ticker: string;
  shares: number;
  avgCost: number;
  lastMark: number | null;
  lastMarkSession: string | null;
  markStale: boolean;
  marketValue: number | null;
};

export type PaperPendingOrderForContext = {
  ticker: string;
  side: string;
  decisionType: string | null;
  sizeFraction: number | null;
  createdAt: string | null;
};

export type PaperBookForContext = {
  cash: number;
  lastMarkSession: string | null;
  positions: PaperBookPositionForContext[];
  pendingOrders: PaperPendingOrderForContext[];
};

/**
 * Paper book as `get_context(book=PAPER)` needs it: open positions + cash + pending
 * orders. Metadata (sleeve, zones, earnings, …) is joined later from shared
 * Portfolio/Watchlist rows — this helper stays paper-ledger-only.
 */
export async function paperBookForContext(branch: Branch): Promise<PaperBookForContext> {
  const [branchRow, listed, orders] = await Promise.all([
    prisma.shadowBranch.findUnique({
      where: { branch },
      select: { cash: true },
    }),
    listShadowPositions({ branch, includeClosed: false }),
    listShadowOrders({ branch, status: "PENDING", limit: 200 }),
  ]);

  let lastMarkSession: string | null = null;
  for (const p of listed.positions) {
    if (p.lastMarkSession && (!lastMarkSession || p.lastMarkSession > lastMarkSession)) {
      lastMarkSession = p.lastMarkSession;
    }
  }

  return {
    cash: roundMoney(decToNum(branchRow?.cash ?? null) ?? 0),
    lastMarkSession,
    positions: listed.positions.map((p) => ({
      ticker: p.ticker,
      shares: p.shares,
      avgCost: p.avgCost ?? 0,
      lastMark: p.lastMark,
      lastMarkSession: p.lastMarkSession,
      markStale: p.markStale,
      marketValue: p.marketValue,
    })),
    pendingOrders: orders.orders.map((o) => ({
      ticker: o.ticker,
      side: o.side,
      decisionType: o.decisionType,
      sizeFraction: o.sizeFraction,
      createdAt: o.createdAt,
    })),
  };
}
