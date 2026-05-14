/**
 * Finnhub US-equities quote: `c` = current / last price.
 * @see https://finnhub.io/docs/api/stock-candles
 */
export async function finnhubLastPrice(symbol: string, apiKey: string): Promise<number | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const u = new URL("https://finnhub.io/api/v1/quote");
  u.searchParams.set("symbol", sym);
  u.searchParams.set("token", apiKey);
  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as { c?: number };
  const c = j.c;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return null;
  return c;
}
