import { prisma } from "@/lib/prisma";
import { isCashTicker, isCspxTicker } from "@/lib/stocks/format";
import { resolveIdeaQuoteSymbol, stockSymbol } from "@/lib/stocks/priceSync";

/**
 * Calendar anchors always included regardless of portfolio/watchlist contents —
 * later commits use these to derive the US trading-session calendar.
 */
export const CALENDAR_ANCHOR_TICKERS = ["SPY", "QQQ", "AAPL", "MSFT"] as const;

const ANCHOR_SET = new Set<string>(CALENDAR_ANCHOR_TICKERS);

/** Benchmark ticker, priced only via EODHD `CSPX.LSE` (see `CSPX_EODHD_SYMBOL`). */
export const CSPX_TICKER = "CSPX";

/**
 * EODHD and stooq spell dotted share classes with dashes (`BRK.B` → `BRK-B`).
 * Applies only to the ticker portion — exchange suffixes like `.US`/`.LSE`
 * are appended by the callers, not passed through here.
 */
function dashShareClass(ticker: string): string {
  return ticker.replaceAll(".", "-");
}

/** EODHD symbol for a US-listed ticker: `AAPL` → `AAPL.US`, `BRK.B` → `BRK-B.US`. */
export function eodhdUsSymbol(ticker: string): string {
  return `${dashShareClass(ticker)}.US`;
}

/** stooq symbol for a US-listed ticker: `AAPL` → `aapl.us`, `BRK.B` → `brk-b.us`. */
export function stooqUsSymbol(ticker: string): string {
  return `${dashShareClass(ticker).toLowerCase()}.us`;
}

/**
 * Add one raw ticker to the nightly universe. Cash is skipped; CSPX is
 * normalised to {@link CSPX_TICKER} because `stockSymbol` rejects it.
 */
export function absorbUniverseTicker(tickers: Set<string>, raw: string | null | undefined): void {
  if (isCashTicker(raw)) return;
  if (isCspxTicker(raw)) {
    tickers.add(CSPX_TICKER);
    return;
  }
  const sym = stockSymbol(raw);
  if (sym) tickers.add(sym);
}

/**
 * Nightly processing order: calendar anchors first (so Finnhub quota hits
 * SPY/QQQ/AAPL/MSFT before idea leads), then the rest A–Z, CSPX included
 * in the remainder (it has its own EODHD path and must not jump the queue).
 */
export function orderPriceHistoryUniverse(tickers: Iterable<string>): string[] {
  const set = new Set(tickers);
  const anchors = CALENDAR_ANCHOR_TICKERS.filter((t) => set.has(t)).sort();
  const rest = [...set].filter((t) => !ANCHOR_SET.has(t)).sort();
  return [...anchors, ...rest];
}

/**
 * Distinct, cleaned ticker universe for price history: Portfolio + Watchlist
 * + Idea `leadTicker`s, plus the calendar anchors and the CSPX benchmark.
 * Idea leads are required for the §12.9 week-move shock listener — without
 * them `get_price_history` is empty and that check is silently un-runnable.
 * Cash rows are excluded; CSPX is special-cased for EODHD.
 *
 * Order is anchors-first (see {@link orderPriceHistoryUniverse}) so adding
 * early-alphabet idea leads cannot starve the session calendar of Finnhub.
 */
export async function buildPriceHistoryUniverse(): Promise<string[]> {
  const [portfolioRows, watchlistRows, ideaRows] = await Promise.all([
    prisma.portfolio.findMany({ select: { ticker: true } }),
    prisma.watchlist.findMany({ select: { ticker: true } }),
    prisma.idea.findMany({ select: { leadTicker: true } }),
  ]);

  const tickers = new Set<string>();
  for (const anchor of CALENDAR_ANCHOR_TICKERS) tickers.add(anchor);
  tickers.add(CSPX_TICKER);

  for (const row of portfolioRows) absorbUniverseTicker(tickers, row.ticker);
  for (const row of watchlistRows) absorbUniverseTicker(tickers, row.ticker);
  for (const row of ideaRows) {
    const lead = resolveIdeaQuoteSymbol(row.leadTicker, null);
    if (lead) tickers.add(lead);
  }

  return orderPriceHistoryUniverse(tickers);
}
