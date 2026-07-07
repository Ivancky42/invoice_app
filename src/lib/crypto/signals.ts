/**
 * Rules-based technical signals. Pure math, no dependencies.
 * All inputs are closing-price arrays ordered oldest→newest.
 */

/** Simple moving average of the last `period` values. Null if not enough data. */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period || period <= 0) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

/**
 * 14-period RSI using Wilder's smoothing. Null if fewer than 15 closes.
 * Returns a value in [0, 100].
 */
export function rsi14(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let gain = 0;
  let loss = 0;
  // Initial average over the first `period` deltas.
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;

  // Wilder smoothing across the remaining deltas.
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Detect a 20/50 MA crossover within the last `withinDays` days.
 * Returns "GOLDEN" (20 crossed above 50), "DEATH" (20 crossed below 50), or null.
 */
export function detectMaCross(
  closes: number[],
  withinDays = 3,
  short = 20,
  long = 50,
): "GOLDEN" | "DEATH" | null {
  if (closes.length < long + withinDays) return null;

  // Diff (ma20 - ma50) at each of the last `withinDays + 1` points.
  const diffs: number[] = [];
  for (let back = withinDays; back >= 0; back--) {
    const slice = closes.slice(0, closes.length - back);
    const s = sma(slice, short);
    const l = sma(slice, long);
    if (s === null || l === null) return null;
    diffs.push(s - l);
  }

  for (let i = 1; i < diffs.length; i++) {
    const prev = diffs[i - 1];
    const cur = diffs[i];
    if (prev <= 0 && cur > 0) return "GOLDEN";
    if (prev >= 0 && cur < 0) return "DEATH";
  }
  return null;
}

/** True if latest volume exceeds 2× the trailing 30-day average. */
export function isVolumeSpike(volumes: number[], window = 30, factor = 2): boolean {
  if (volumes.length < window + 1) return false;
  const latest = volumes[volumes.length - 1];
  const prior = volumes.slice(volumes.length - 1 - window, volumes.length - 1);
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (avg <= 0) return false;
  return latest > avg * factor;
}

function dailyReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) r.push((closes[i] - prev) / prev);
    else r.push(0);
  }
  return r;
}

/**
 * 30-day beta of an asset vs BTC (daily returns). Null if insufficient/degenerate data.
 * Uses the last 30 overlapping return pairs.
 */
export function beta30d(assetCloses: number[], btcCloses: number[]): number | null {
  const a = dailyReturns(assetCloses);
  const b = dailyReturns(btcCloses);
  const n = Math.min(a.length, b.length, 30);
  if (n < 10) return null;
  const ar = a.slice(a.length - n);
  const br = b.slice(b.length - n);

  const meanA = ar.reduce((s, x) => s + x, 0) / n;
  const meanB = br.reduce((s, x) => s + x, 0) / n;

  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (ar[i] - meanA) * (br[i] - meanB);
    varB += (br[i] - meanB) ** 2;
  }
  if (varB === 0) return null;
  return cov / varB;
}

export type FlagInputs = {
  rsi14: number | null;
  maCross: "GOLDEN" | "DEATH" | null;
  volumeSpike: boolean;
  fundingRate: number | null; // fraction per 8h
  tvlChange7dPct: number | null;
  athDrawdownPct: number | null;
};

/** Compute the human-readable signal flags from computed metrics. */
export function computeFlags(input: FlagInputs): string[] {
  const flags: string[] = [];

  if (input.rsi14 !== null) {
    if (input.rsi14 > 70) flags.push("RSI_OVERBOUGHT");
    else if (input.rsi14 < 30) flags.push("RSI_OVERSOLD");
  }
  if (input.maCross === "GOLDEN") flags.push("GOLDEN_CROSS");
  else if (input.maCross === "DEATH") flags.push("DEATH_CROSS");

  if (input.volumeSpike) flags.push("VOLUME_SPIKE");

  // |funding| > 0.05% per 8h.
  if (input.fundingRate !== null && Math.abs(input.fundingRate) > 0.0005) {
    flags.push("FUNDING_EXTREME");
  }

  if (input.tvlChange7dPct !== null) {
    if (input.tvlChange7dPct < -10) flags.push("TVL_DROP_7D");
    else if (input.tvlChange7dPct > 15) flags.push("TVL_SURGE_7D");
  }

  if (input.athDrawdownPct !== null && input.athDrawdownPct < -70) {
    flags.push("ATH_DRAWDOWN_DEEP");
  }

  return flags;
}
