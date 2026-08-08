import { prisma } from "@/lib/prisma";
import { isCashTicker, isCspxTicker } from "@/lib/stocks/format";
import { stockSymbol } from "@/lib/stocks/priceSync";

/**
 * Calendar anchors always included regardless of portfolio/watchlist contents —
 * later commits use these to derive the US trading-session calendar.
 */
export const CALENDAR_ANCHOR_TICKERS = ["SPY", "QQQ", "AAPL", "MSFT"] as const;

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
 * Distinct, cleaned ticker universe for price history: Portfolio + Watchlist
 * tickers, plus the calendar anchors and the CSPX benchmark, always. Cash
 * rows are excluded; CSPX passes through `isCspxTicker` (not `stockSymbol`,
 * which rejects it) since callers special-case it for EODHD.
 */
export async function buildPriceHistoryUniverse(): Promise<string[]> {
  const [portfolioRows, watchlistRows] = await Promise.all([
    prisma.portfolio.findMany({ select: { ticker: true } }),
    prisma.watchlist.findMany({ select: { ticker: true } }),
  ]);

  const tickers = new Set<string>();
  for (const anchor of CALENDAR_ANCHOR_TICKERS) tickers.add(anchor);
  tickers.add(CSPX_TICKER);

  for (const row of [...portfolioRows, ...watchlistRows]) {
    const raw = row.ticker;
    if (isCashTicker(raw)) continue;
    if (isCspxTicker(raw)) {
      tickers.add(CSPX_TICKER);
      continue;
    }
    const sym = stockSymbol(raw);
    if (sym) tickers.add(sym);
  }

  return [...tickers].sort();
}
