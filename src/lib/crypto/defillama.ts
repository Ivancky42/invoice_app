/**
 * DeFiLlama TVL helper. Free, keyless. Returns latest chain TVL + 7d change.
 * Uses `cache: "no-store"`, an 8s timeout, and returns null on error.
 */

export type ChainTvl = { tvl: number; change7dPct: number | null };

/** Latest TVL for a DeFiLlama chain slug (e.g. "Sei") + 7-day % change. */
export async function llamaChainTvl(slug: string): Promise<ChainTvl | null> {
  try {
    const res = await fetch(
      `https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(slug)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { date: number; tvl: number }[];
    if (!Array.isArray(data) || data.length === 0) return null;

    const latest = data[data.length - 1];
    if (!latest || !Number.isFinite(latest.tvl)) return null;

    // 7 daily points back (data is one point per day).
    const priorIdx = data.length - 1 - 7;
    let change7dPct: number | null = null;
    if (priorIdx >= 0) {
      const prior = data[priorIdx];
      if (prior && Number.isFinite(prior.tvl) && prior.tvl > 0) {
        change7dPct = ((latest.tvl - prior.tvl) / prior.tvl) * 100;
      }
    }
    return { tvl: latest.tvl, change7dPct };
  } catch {
    return null;
  }
}
