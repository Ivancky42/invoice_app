/**
 * Breadth computation for noise classification (`classifyMove` in ./math).
 *
 * `computeBreadthForSession` is the ONE sanctioned exception to "src/lib/shadow/ and
 * src/lib/fitness/counterfactuals must not read the book": Portfolio.theme /
 * Watchlist.theme are read here to build a ticker→theme map, which is market-structure
 * data (what sector/narrative a name belongs to), not book state (what is held, sized,
 * or P&L'd). This module stays READ-ONLY and ticker→theme ONLY — it never reads shares,
 * cost basis, stops, or anything else that would leak the real book into the shadow
 * ledger's fitness signal.
 *
 * Reads PriceHistory (bars), Portfolio + Watchlist (theme mapping only).
 */
import { prisma } from "@/lib/prisma";
import {
  loadSessions,
  previousSessionBeforeIn,
  sessionDate,
  ymd,
} from "@/lib/shadow/sessions";
import { decToNum } from "@/lib/stocks/format";

/** breadth / themeBreadth columns are Decimal(6,4). */
function roundBreadth(value: number): number {
  const rounded = Math.round(value * 1e4) / 1e4;
  return rounded === 0 ? 0 : rounded;
}

/** excessMove is Decimal(10,6), same scale as every other fraction column. */
function roundExcess(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

export type BreadthFromReturns = {
  medianReturn: number;
  /** Fraction of the sample with a strictly positive return. */
  breadthUp: number;
  /** Fraction of the sample with a strictly negative return. */
  breadthDown: number;
};

/**
 * Pure: median and up/down breadth of a set of 1-session returns.
 * Flat (exactly 0) returns count towards neither breadthUp nor breadthDown.
 */
export function breadthFromReturns(returns: number[]): BreadthFromReturns {
  const values = returns.filter((r) => Number.isFinite(r));
  const n = values.length;
  if (n === 0) return { medianReturn: 0, breadthUp: 0, breadthDown: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const medianReturn =
    n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  const up = values.filter((r) => r > 0).length;
  const down = values.filter((r) => r < 0).length;

  return {
    medianReturn: roundExcess(medianReturn),
    breadthUp: roundBreadth(up / n),
    breadthDown: roundBreadth(down / n),
  };
}

/** Pure: a ticker's move beyond the market median (signed fraction). */
export function excessMoveOf(tickerReturn: number, medianReturn: number): number {
  return roundExcess(tickerReturn - medianReturn);
}

/**
 * Pure: fraction of `ticker`'s theme moving the SAME direction as `ticker` itself.
 * Requires at least 3 OTHER same-theme tickers with a return; flat returns (0) never
 * count as "same direction" as anything, including another flat return.
 */
export function themeBreadthFor(
  ticker: string,
  byTicker: Map<string, number>,
  themeOf: Map<string, string>,
): number | null {
  const tickerReturn = byTicker.get(ticker);
  const theme = themeOf.get(ticker);
  if (tickerReturn === undefined || theme === undefined) return null;

  const direction = Math.sign(tickerReturn);
  if (direction === 0) return null;

  const memberReturns: number[] = [];
  for (const [otherTicker, otherReturn] of byTicker) {
    if (otherTicker === ticker) continue;
    if (themeOf.get(otherTicker) !== theme) continue;
    memberReturns.push(otherReturn);
  }
  if (memberReturns.length < 3) return null;

  const sameDirection = memberReturns.filter((r) => Math.sign(r) === direction).length;
  return roundBreadth(sameDirection / memberReturns.length);
}

export type SessionBreadth = {
  sampleSize: number;
  medianReturn: number;
  breadthUp: number;
  breadthDown: number;
  /** 1-session return by ticker, tickers with a bar on both `session` and its prior. */
  byTicker: Map<string, number>;
};

/** Minimum universe size before breadth is meaningful (matches classifyMove's floor). */
export const MIN_BREADTH_SAMPLE = 10;

/**
 * Index/ETF proxies force-included in PriceHistory for the session calendar and
 * benchmark, not market constituents (SPY and CSPX even track the SAME index) —
 * counting them would double-count market moves and bias the median, worst near
 * MIN_BREADTH_SAMPLE. AAPL/MSFT stay: they are real stocks.
 */
export const BREADTH_EXCLUDED_TICKERS = new Set(["SPY", "QQQ", "CSPX"]);

/**
 * Pure: {@link SessionBreadth} from raw per-ticker 1-session returns, after dropping
 * {@link BREADTH_EXCLUDED_TICKERS}. Returns null when fewer than
 * {@link MIN_BREADTH_SAMPLE} constituents remain.
 */
export function sessionBreadthFromByTicker(
  rawByTicker: Map<string, number>,
): SessionBreadth | null {
  const byTicker = new Map<string, number>();
  for (const [ticker, ret] of rawByTicker) {
    if (BREADTH_EXCLUDED_TICKERS.has(ticker)) continue;
    byTicker.set(ticker, ret);
  }

  if (byTicker.size < MIN_BREADTH_SAMPLE) return null;

  const { medianReturn, breadthUp, breadthDown } = breadthFromReturns([...byTicker.values()]);
  return { sampleSize: byTicker.size, medianReturn, breadthUp, breadthDown, byTicker };
}

/**
 * Universe-wide breadth at `session`, from PriceHistory bars at `session` and the
 * immediately prior session. Returns null when fewer than {@link MIN_BREADTH_SAMPLE}
 * tickers have a bar on both sessions — the caller should treat that as
 * INSUFFICIENT_DATA rather than compute a breadth off a thin sample.
 */
export async function computeBreadthForSession(session: string): Promise<SessionBreadth | null> {
  const sessions = await loadSessions();
  const prior = previousSessionBeforeIn(sessions, session);
  if (!prior) return null;

  const bars = await prisma.priceHistory.findMany({
    where: { date: { in: [sessionDate(session), sessionDate(prior)] } },
    select: { ticker: true, date: true, close: true },
  });

  const closeByKey = new Map<string, number>();
  const tickers = new Set<string>();
  for (const bar of bars) {
    const close = decToNum(bar.close);
    if (close === null || close <= 0) continue;
    tickers.add(bar.ticker);
    closeByKey.set(`${bar.ticker}|${ymd(bar.date)}`, close);
  }

  const byTicker = new Map<string, number>();
  for (const ticker of tickers) {
    const now = closeByKey.get(`${ticker}|${session}`);
    const before = closeByKey.get(`${ticker}|${prior}`);
    if (now === undefined || before === undefined) continue;
    byTicker.set(ticker, now / before - 1);
  }

  return sessionBreadthFromByTicker(byTicker);
}

/**
 * Ticker → theme map from Portfolio + Watchlist. READ-ONLY, ticker→theme ONLY — see the
 * module doc comment above for why this is the sanctioned book-read exception.
 */
export async function loadThemeByTicker(): Promise<Map<string, string>> {
  const [portfolioRows, watchlistRows] = await Promise.all([
    prisma.portfolio.findMany({
      where: { theme: { not: null } },
      select: { ticker: true, theme: true },
    }),
    prisma.watchlist.findMany({
      where: { theme: { not: null } },
      select: { ticker: true, theme: true },
    }),
  ]);

  const themeOf = new Map<string, string>();
  for (const row of portfolioRows) {
    if (row.theme) themeOf.set(row.ticker.trim().toUpperCase(), row.theme);
  }
  for (const row of watchlistRows) {
    // Portfolio wins on a ticker present in both: it is the more current source.
    if (row.theme && !themeOf.has(row.ticker.trim().toUpperCase())) {
      themeOf.set(row.ticker.trim().toUpperCase(), row.theme);
    }
  }
  return themeOf;
}
