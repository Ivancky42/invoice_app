import { finnhubQuote } from "@/lib/finnhub/quote";
import type { DailyBar, NightlyBarProvider } from "@/lib/pricehistory/types";

/** Reject a Finnhub quote timestamp older than this — stale-market / bad-symbol guard. */
const MAX_QUOTE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** US Eastern session date (YYYY-MM-DD) for a Finnhub quote epoch-seconds timestamp. */
export function easternSessionDate(epochSeconds: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Nightly bar from Finnhub's `/quote`: today's open/close, dated by the
 * quote's own timestamp (Eastern session date), not fetch time.
 */
export async function fetchFinnhubDailyBar(
  ticker: string,
  apiKey: string,
): Promise<DailyBar | null> {
  const quote = await finnhubQuote(ticker, apiKey);
  if (!quote) return null;

  const { c, o, t } = quote;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return null;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;

  const ageMs = Date.now() - t * 1000;
  if (ageMs > MAX_QUOTE_AGE_MS) return null;

  return {
    ticker: ticker.trim().toUpperCase(),
    date: easternSessionDate(t),
    open: typeof o === "number" && Number.isFinite(o) && o > 0 ? o : undefined,
    close: c,
    source: "finnhub",
  };
}

export const finnhubNightlyProvider: NightlyBarProvider = {
  source: "finnhub",
  fetchBar: fetchFinnhubDailyBar,
};
