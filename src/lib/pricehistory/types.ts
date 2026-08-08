/** Valid price-history sources — must match PriceHistory.source strings written to Neon. */
export type PriceHistorySource = "finnhub" | "eodhd" | "stooq";

/** One daily OHLC bar, provider-agnostic. */
export type DailyBar = {
  ticker: string;
  /** US session date, YYYY-MM-DD. */
  date: string;
  open?: number;
  close: number;
  adjClose?: number;
  volume?: number;
  source: PriceHistorySource;
};

/** Fetches "today's" bar for one ticker (nightly sync path). */
export type NightlyBarProvider = {
  source: PriceHistorySource;
  fetchBar(ticker: string, apiKey: string): Promise<DailyBar | null>;
};

/** Fetches a date-ranged history of bars for one ticker (backfill path). */
export type HistoryProvider = {
  source: PriceHistorySource;
  fetchHistory(ticker: string, from: string, to: string, apiKey?: string): Promise<DailyBar[]>;
};
