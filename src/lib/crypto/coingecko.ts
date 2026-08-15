/**
 * CoinGecko public API helpers. Works keyless at lower rate limits; a Demo key
 * (COINGECKO_API_KEY) raises limits via the `x_cg_demo_api_key` param.
 * All helpers use `cache: "no-store"`, an 8s timeout, and return null/[] on error.
 */

const CG_BASE = "https://api.coingecko.com/api/v3";

function withKey(u: URL): URL {
  const key = process.env.COINGECKO_API_KEY?.trim();
  if (key) u.searchParams.set("x_cg_demo_api_key", key);
  return u;
}

async function cgFetch<T>(u: URL): Promise<T | null> {
  try {
    const res = await fetch(withKey(u).toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type CgMarket = {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency: number | null;
  ath: number | null;
  ath_change_percentage: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
};

/** `/coins/markets` for the given CoinGecko ids (vs USD). */
export async function cgMarkets(ids: string[]): Promise<CgMarket[]> {
  if (ids.length === 0) return [];
  const u = new URL(`${CG_BASE}/coins/markets`);
  u.searchParams.set("vs_currency", "usd");
  u.searchParams.set("ids", ids.join(","));
  u.searchParams.set("price_change_percentage", "24h,7d");
  u.searchParams.set("per_page", String(Math.min(ids.length, 250)));
  const data = await cgFetch<CgMarket[]>(u);
  return Array.isArray(data) ? data : [];
}

export type CgTrendingCoin = {
  id: string;
  symbol: string;
  name: string;
};

/** `/search/trending` → up to ~15 trending coins. */
export async function cgTrending(): Promise<CgTrendingCoin[]> {
  const u = new URL(`${CG_BASE}/search/trending`);
  const data = await cgFetch<{ coins?: { item?: CgTrendingCoin }[] }>(u);
  const coins = data?.coins ?? [];
  const out: CgTrendingCoin[] = [];
  for (const c of coins) {
    const item = c.item;
    if (item?.id && item.symbol && item.name) {
      out.push({ id: item.id, symbol: item.symbol, name: item.name });
    }
  }
  return out;
}

/**
 * Daily closing prices fallback (`/coins/{id}/market_chart`). Days must be > 90:
 * CoinGecko auto-granularity only returns one point per day above 90 days
 * (the `/ohlc` endpoint would return 4-day candles, which breaks RSI/MA math).
 * Returns closes oldest→newest — enough for RSI/MA when Binance klines fail.
 */
export async function cgOhlcDaily(id: string, days = 91): Promise<number[]> {
  const u = new URL(`${CG_BASE}/coins/${id}/market_chart`);
  u.searchParams.set("vs_currency", "usd");
  u.searchParams.set("days", String(Math.max(days, 91)));
  const data = await cgFetch<{ prices?: number[][] }>(u);
  const prices = data?.prices;
  if (!Array.isArray(prices)) return [];
  const closes: number[] = [];
  for (const row of prices) {
    // [timestamp, price]
    const close = Array.isArray(row) ? row[1] : undefined;
    if (typeof close === "number" && Number.isFinite(close)) closes.push(close);
  }
  return closes;
}
