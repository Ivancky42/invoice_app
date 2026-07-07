/**
 * Binance public-data helpers. Spot data via the public mirror
 * (data-api.binance.vision) to avoid US geo-blocking (api.binance.com → 451).
 * Futures (funding rate / open interest) are strictly optional — null on failure.
 * All helpers use `cache: "no-store"`, an 8s timeout, and return null/[] on error.
 */

const SPOT_BASE =
  process.env.BINANCE_API_BASE?.trim() || "https://data-api.binance.vision";
const FUTURES_BASE = "https://fapi.binance.com";

async function binFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type Kline = { close: number; volume: number; closeTime: number };

/** Daily klines (oldest→newest). Empty array on failure — callers fall back to CoinGecko. */
export async function binanceKlines(symbol: string, limit = 60): Promise<Kline[]> {
  const u = new URL(`${SPOT_BASE}/api/v3/klines`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("interval", "1d");
  u.searchParams.set("limit", String(limit));
  const data = await binFetch<unknown[][]>(u.toString());
  if (!Array.isArray(data)) return [];
  const out: Kline[] = [];
  for (const row of data) {
    // [openTime, open, high, low, close, volume, closeTime, ...]
    const close = Number(row[4]);
    const volume = Number(row[5]);
    const closeTime = Number(row[6]);
    if (Number.isFinite(close) && Number.isFinite(volume)) {
      out.push({ close, volume, closeTime });
    }
  }
  return out;
}

/** Latest perpetual funding rate (fraction per 8h). Null if unavailable. */
export async function binanceFundingRate(symbol: string): Promise<number | null> {
  const u = new URL(`${FUTURES_BASE}/fapi/v1/fundingRate`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("limit", "1");
  const data = await binFetch<{ fundingRate?: string }[]>(u.toString());
  const raw = Array.isArray(data) && data[0]?.fundingRate;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Latest open interest (base-asset units). Null if unavailable. */
export async function binanceOpenInterest(symbol: string): Promise<number | null> {
  const u = new URL(`${FUTURES_BASE}/fapi/v1/openInterest`);
  u.searchParams.set("symbol", symbol);
  const data = await binFetch<{ openInterest?: string }>(u.toString());
  const n = data?.openInterest != null ? Number(data.openInterest) : NaN;
  return Number.isFinite(n) ? n : null;
}
