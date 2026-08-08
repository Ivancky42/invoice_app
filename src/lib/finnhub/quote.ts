/** Raw Finnhub `/quote` payload: c=current, o=open, h=high, l=low, pc=prev close, t=quote epoch seconds. */
export type FinnhubQuote = {
  c?: number;
  o?: number;
  h?: number;
  l?: number;
  pc?: number;
  t?: number;
};

/**
 * Full Finnhub US-equities quote (current, open, high, low, prev close, timestamp).
 * @see https://finnhub.io/docs/api/stock-candles
 */
export async function finnhubQuote(symbol: string, apiKey: string): Promise<FinnhubQuote | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const u = new URL("https://finnhub.io/api/v1/quote");
  u.searchParams.set("symbol", sym);
  u.searchParams.set("token", apiKey);
  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as FinnhubQuote;
}

/**
 * Finnhub US-equities quote: `c` = current / last price.
 * @see https://finnhub.io/docs/api/stock-candles
 */
export async function finnhubLastPrice(symbol: string, apiKey: string): Promise<number | null> {
  const j = await finnhubQuote(symbol, apiKey);
  const c = j?.c;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return null;
  return c;
}
