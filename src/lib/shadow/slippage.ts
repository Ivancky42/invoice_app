/**
 * Adverse fill slippage for the paper ledger.
 *
 * Buys pay up; sells receive down. Applied to the session OPEN before sizing so cash,
 * shares, and recorded fillPrice all reflect the same worse price — trading is never free
 * in the book, and the fitness turnover term is a separate hyperactivity tax on top.
 */
export const SLIPPAGE_BPS = 10;

export type SlippageSide = "BUY" | "SELL";

/** Fraction of price: 10 bps → 0.001. */
export function slippageFraction(bps: number = SLIPPAGE_BPS): number {
  if (!Number.isFinite(bps) || bps < 0) return 0;
  return bps / 10_000;
}

/**
 * Adverse price after slippage. Non-positive inputs are returned unchanged (callers already
 * reject non-positive opens before sizing).
 */
export function applySlippage(
  openPrice: number,
  side: SlippageSide,
  bps: number = SLIPPAGE_BPS,
): number {
  if (!Number.isFinite(openPrice) || openPrice <= 0) return openPrice;
  const slip = slippageFraction(bps);
  if (slip === 0) return openPrice;
  return side === "BUY" ? openPrice * (1 + slip) : openPrice * (1 - slip);
}
