/**
 * Alternative.me Crypto Fear & Greed Index (0-100). Free, keyless.
 * Uses `cache: "no-store"`, an 8s timeout, and returns null on error.
 */

export type FearGreed = { value: number; classification: string | null };

export async function fetchFearGreed(): Promise<FearGreed | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { value?: string; value_classification?: string }[];
    };
    const entry = data.data?.[0];
    const value = entry?.value != null ? Number(entry.value) : NaN;
    if (!Number.isFinite(value)) return null;
    return { value, classification: entry?.value_classification ?? null };
  } catch {
    return null;
  }
}
