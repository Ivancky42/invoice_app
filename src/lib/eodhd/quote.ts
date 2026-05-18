/**
 * EODHD real-time quote: `close` = last trade price.
 * @see https://eodhd.com/financial-apis/real-time-stock-api
 */

/** LSE listing for iShares Core S&P 500 UCITS ETF (Notion ticker `CSPX`). */
export const CSPX_EODHD_SYMBOL = "CSPX.LSE";

export async function eodhdRealTimeClose(symbol: string, apiKey: string): Promise<number | null> {
  const sym = symbol.trim();
  const key = apiKey.trim();
  if (!sym || !key) return null;
  const u = new URL(`https://eodhistoricaldata.com/api/real-time/${encodeURIComponent(sym)}`);
  u.searchParams.set("api_token", key);
  u.searchParams.set("fmt", "json");
  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as { close?: unknown };
  const c = j.close;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return null;
  return c;
}
