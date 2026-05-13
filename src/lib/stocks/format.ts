import type { Decimal } from "@/generated/prisma/internal/prismaNamespace";
import type { TradeRow } from "@/lib/stocks/db";

export function decToNum(d: Decimal | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  const n = typeof d === "number" ? d : Number((d as unknown as { toString(): string }).toString());
  return Number.isFinite(n) ? n : null;
}

/** Notion Portfolio DB uses ticker `CASH_USD` for the cash / money-market balance row. */
export function isCashTicker(ticker: string | null | undefined): boolean {
  return (ticker ?? "").trim().toUpperCase() === "CASH_USD";
}

/**
 * USD balance on that row: **Current Price**, else **My Avg Cost** (Notion often duplicates both).
 */
export function notionCashBalanceUsd(
  currentPrice: Parameters<typeof decToNum>[0],
  avgCost: Parameters<typeof decToNum>[0],
): number {
  const cur = decToNum(currentPrice);
  const cost = decToNum(avgCost);
  if (cur !== null && cur > 0) return cur;
  if (cost !== null && cost > 0) return cost;
  return 0;
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtPct(d: Decimal | number | null | undefined): string {
  const n = typeof d === "number" ? d : decToNum(d ?? null);
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Action badge color mapping (Tailwind classes, neutral palette + accents). */
export function actionBadgeClass(action: string | null | undefined): string {
  switch (action) {
    case "ADD on dip":
      return "bg-emerald-100 text-emerald-800";
    case "HOLD":
      return "bg-gray-100 text-gray-700";
    case "REDUCE":
      return "bg-amber-100 text-amber-800";
    case "EXIT":
      return "bg-red-100 text-red-700";
    case "WATCH":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function riskBadgeClass(level: string | null | undefined): string {
  switch (level) {
    case "Low":
      return "bg-emerald-50 text-emerald-700";
    case "Low-Medium":
      return "bg-emerald-50 text-emerald-700";
    case "Medium":
      return "bg-yellow-50 text-yellow-700";
    case "Medium-High":
      return "bg-orange-50 text-orange-700";
    case "High":
      return "bg-red-50 text-red-700";
    case "Very High":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-50 text-gray-600";
  }
}

export function priorityBadgeClass(priority: string | null | undefined): string {
  if (!priority) return "bg-gray-100 text-gray-600";
  if (priority.includes("Buy now")) return "bg-emerald-100 text-emerald-800";
  if (priority.includes("Wait for entry")) return "bg-blue-100 text-blue-700";
  if (priority.includes("Watch")) return "bg-gray-100 text-gray-700";
  if (priority.includes("Skip")) return "bg-red-50 text-red-700";
  return "bg-gray-100 text-gray-700";
}

/** Compute per-share P&L vs avg cost (in dollars and percent). */
export function pnl(currentPrice: number | null, avgCost: number | null): { dollar: number | null; pct: number | null } {
  if (currentPrice === null || avgCost === null || avgCost === 0) return { dollar: null, pct: null };
  return {
    dollar: currentPrice - avgCost,
    pct: (currentPrice - avgCost) / avgCost,
  };
}

/**
 * Compute net shares currently held per ticker by walking the trade log.
 * Adds (BUY/ADD) increase the position; reductions (SELL/TRIM/EXIT/STOP/CLOSE)
 * decrease it. Tickers with zero or near-zero net shares are dropped.
 */
export function holdingsByTicker(trades: TradeRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of trades) {
    if (!t.ticker) continue;
    const shares = decToNum(t.shares);
    if (shares === null || shares === 0) continue;
    const type = (t.type ?? "").toUpperCase();
    let signed = 0;
    if (type.includes("BUY") || type.includes("ADD")) {
      signed = Math.abs(shares);
    } else if (
      type.includes("SELL") ||
      type.includes("TRIM") ||
      type.includes("EXIT") ||
      type.includes("STOP") ||
      type.includes("CLOSE")
    ) {
      signed = -Math.abs(shares);
    } else {
      continue;
    }
    map.set(t.ticker, (map.get(t.ticker) ?? 0) + signed);
  }
  for (const [k, v] of map) {
    if (Math.abs(v) < 1e-6) map.delete(k);
  }
  return map;
}

/** Position-level P&L in actual dollars: shares * (currentPrice - avgCost). */
export function positionPnl(
  currentPrice: number | null,
  avgCost: number | null,
  shares: number | null,
): { dollar: number | null; pct: number | null; marketValue: number | null; costBasis: number | null } {
  const per = pnl(currentPrice, avgCost);
  if (shares === null || shares === 0 || per.dollar === null) {
    return { dollar: null, pct: per.pct, marketValue: null, costBasis: null };
  }
  return {
    dollar: per.dollar * shares,
    pct: per.pct,
    marketValue: (currentPrice ?? 0) * shares,
    costBasis: (avgCost ?? 0) * shares,
  };
}
