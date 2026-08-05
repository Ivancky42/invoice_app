import type { Decimal } from "@/generated/prisma/internal/prismaNamespace";
import type {
  PositionAction,
  RiskLevel,
  TradeType,
  WatchlistPriority,
} from "@/generated/prisma/client";
import type { TradeRow } from "@/lib/stocks/db";
import {
  NULL_BADGE_CLASS,
  POSITION_ACTION_CLASS,
  RISK_LEVEL_CLASS,
  TRADE_TYPE_CLASS,
  WATCHLIST_PRIORITY_CLASS,
} from "@/lib/stocks/labels";
import {
  normalizePositionAction,
  normalizeRiskLevel,
  normalizeWatchlistPriority,
} from "@/lib/stocks/normalizeStatus";
import { parseTradeType, TRADE_DIRECTION } from "@/lib/stocks/tradeMath";

export function decToNum(d: Decimal | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  const n = typeof d === "number" ? d : Number((d as unknown as { toString(): string }).toString());
  return Number.isFinite(n) ? n : null;
}

/** Notion Portfolio DB uses ticker `CASH_USD` for the cash / money-market balance row. */
export function isCashTicker(ticker: string | null | undefined): boolean {
  return (ticker ?? "").trim().toUpperCase() === "CASH_USD";
}

/** Notion Portfolio DB uses ticker `CSPX` for the passive S&P 500 ETF (priced via EODHD, not Finnhub). */
export function isCspxTicker(ticker: string | null | undefined): boolean {
  return (ticker ?? "").trim().toUpperCase() === "CSPX";
}

/** Rows/symbols we never send to Finnhub (Neon price sync manual + cron). */
export function isPriceSyncExcludedTicker(ticker: string | null | undefined): boolean {
  if (isCashTicker(ticker)) return true;
  return isCspxTicker(ticker);
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

/**
 * Pull every money-like number out of free-form Entry zone text (supports `$`, commas, `160–175`, `160 to 175`).
 * Avoids naive `-` splitting, which can glue digits (`160 to 175` → `160175`) or over-split decimals.
 */
function extractEntryZoneNumbers(entryZone: string): number[] {
  const normalized = entryZone
    .replace(/\u2013/g, " ")
    .replace(/\u2014/g, " ")
    .replace(/,/g, "");
  const re = /\$?\s*([\d]+(?:\.\d+)?)/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Low / high of the DCA band from Notion **Entry Zone** text.
 * Uses the **min and max** of all parsed prices when **two or more** numbers exist; one number yields only `high` (for display / sort, not for the in-zone badge).
 */
export function parseDcaZoneBounds(entryZone: string | null | undefined): {
  low: number | null;
  high: number | null;
} {
  if (!entryZone?.trim()) return { low: null, high: null };
  const nums = extractEntryZoneNumbers(entryZone.trim());
  if (nums.length >= 2) {
    return { low: Math.min(...nums), high: Math.max(...nums) };
  }
  if (nums.length === 1) {
    return { low: null, high: nums[0]! };
  }
  return { low: null, high: null };
}

export function parseDcaZoneUpper(entryZone: string | null | undefined): number | null {
  const { low, high } = parseDcaZoneBounds(entryZone);
  if (high === null) return null;
  if (low !== null) return high;
  return high;
}

/**
 * True when **current price** is **inside** a **two-ended** entry band (inclusive).
 * A single price in the field is ignored for the badge so we don’t treat “/ under $175” as “always in zone” for cheap stocks.
 */
export function priceInDcaZone(
  currentPrice: Parameters<typeof decToNum>[0],
  entryZone: string | null | undefined,
): boolean {
  const cur = decToNum(currentPrice);
  if (cur === null) return false;
  const nums = extractEntryZoneNumbers((entryZone ?? "").trim());
  if (nums.length < 2) return false;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return cur >= lo && cur <= hi;
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

const UTC_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** SSR-safe short UTC date, e.g. "May 27" — avoids Intl locale drift between Node and browser. */
export function fmtShortDateUtc(iso: string): string {
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return `${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${UTC_MONTHS[parseInt(m[2]!, 10) - 1]} ${parseInt(m[3]!, 10)}`;
  }
  return iso.slice(0, 10);
}

/** Fixed-decimal USD string — stable across server/client (for SVG attributes). */
export function fmtMoneyFixed(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(digits)}`;
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

/**
 * Badge class for PositionAction. Accepts enum or legacy Notion string (normalised).
 * Grey only when null/undefined or unmapped legacy string — never a silent default for known enums.
 */
export function actionBadgeClass(
  action: PositionAction | string | null | undefined,
): string {
  if (action == null) return NULL_BADGE_CLASS;
  if (action in POSITION_ACTION_CLASS) return POSITION_ACTION_CLASS[action as PositionAction];
  const v = normalizePositionAction(action);
  if (v == null) return NULL_BADGE_CLASS;
  return POSITION_ACTION_CLASS[v];
}

export function riskBadgeClass(level: RiskLevel | string | null | undefined): string {
  if (level == null) return NULL_BADGE_CLASS;
  if (level in RISK_LEVEL_CLASS) return RISK_LEVEL_CLASS[level as RiskLevel];
  const v = normalizeRiskLevel(level);
  if (v == null) return NULL_BADGE_CLASS;
  return RISK_LEVEL_CLASS[v];
}

export function priorityBadgeClass(
  priority: WatchlistPriority | string | null | undefined,
): string {
  if (priority == null) return NULL_BADGE_CLASS;
  if (priority in WATCHLIST_PRIORITY_CLASS) {
    return WATCHLIST_PRIORITY_CLASS[priority as WatchlistPriority];
  }
  const v = normalizeWatchlistPriority(priority);
  if (v == null) return NULL_BADGE_CLASS;
  return WATCHLIST_PRIORITY_CLASS[v];
}

export function tradeTypeBadgeClass(type: TradeType | string | null | undefined): string {
  if (type == null) return NULL_BADGE_CLASS;
  const v = parseTradeType(type);
  if (v == null) return NULL_BADGE_CLASS;
  return TRADE_TYPE_CLASS[v];
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
 * Direction comes from TRADE_DIRECTION via parseTradeType (enum or legacy string).
 * Tickers with zero or near-zero net shares are dropped.
 */
export function holdingsByTicker(trades: TradeRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of trades) {
    if (!t.ticker) continue;
    const key = t.ticker.trim().toUpperCase();
    if (!key) continue;
    const shares = decToNum(t.shares);
    if (shares === null || shares === 0) continue;
    // Prefer enum column; fall back to typeRaw during transition.
    const parsed = parseTradeType(t.type ?? (t as { typeRaw?: string | null }).typeRaw);
    if (parsed == null) continue;
    const signed = TRADE_DIRECTION[parsed] * Math.abs(shares);
    map.set(key, (map.get(key) ?? 0) + signed);
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
