/**
 * Paper fill arithmetic. PURE — no prisma, no real-book state.
 * Kept separate from the job so weighted averaging, cash-constrained partial fills and
 * realized P&L are unit-testable without a database.
 */

/** Money columns are Decimal(18,4) / prices Decimal(14,4). */
export function roundMoney(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Share columns are Decimal(18,6). */
export function roundShares(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Below this many shares a position is dust and counts as closed. */
export const SHARE_EPSILON = 1e-6;

export type BuyPlan =
  | { ok: true; notional: number; shares: number; partial: boolean }
  | { ok: false; reason: "insufficient_cash" };

/**
 * Cash-constrained buy. Paper cash may never go negative: a desired notional larger than
 * available cash fills partially; no cash at all rejects rather than borrowing.
 */
export function planBuy(desiredNotional: number, cash: number, price: number): BuyPlan {
  if (!(price > 0)) return { ok: false, reason: "insufficient_cash" };
  const available = roundMoney(Math.max(0, cash));
  if (available <= 0) return { ok: false, reason: "insufficient_cash" };

  const desired = roundMoney(Math.max(0, desiredNotional));
  const notional = roundMoney(Math.min(desired, available));
  const shares = roundShares(notional / price);
  if (notional <= 0 || shares <= 0) return { ok: false, reason: "insufficient_cash" };
  return { ok: true, notional, shares, partial: notional < desired };
}

/** Weighted average cost after adding `addShares` at `addPrice`. */
export function weightedAvgCost(
  existingShares: number,
  existingAvgCost: number,
  addShares: number,
  addPrice: number,
): number {
  const totalShares = existingShares + addShares;
  if (totalShares <= 0) return roundMoney(addPrice);
  const cost = existingShares * existingAvgCost + addShares * addPrice;
  return roundMoney(cost / totalShares);
}

export type SellPlan =
  | {
      ok: true;
      sharesSold: number;
      proceeds: number;
      realizedPnl: number;
      remainingShares: number;
      closes: boolean;
    }
  | { ok: false; reason: "no_position" };

/**
 * Sell `positionFraction` of an open position at `price`.
 * A full exit (fraction 1) closes exactly; a residue inside {@link SHARE_EPSILON} is
 * swept into the sale so rounding cannot strand an un-closable dust position.
 */
export function planSell(
  openShares: number,
  avgCost: number,
  positionFraction: number,
  price: number,
): SellPlan {
  if (!(openShares > 0) || !(price > 0)) return { ok: false, reason: "no_position" };
  const fraction = Math.min(1, Math.max(0, positionFraction));
  let sharesSold = roundShares(openShares * fraction);
  if (sharesSold <= 0) return { ok: false, reason: "no_position" };

  let remainingShares = roundShares(openShares - sharesSold);
  if (remainingShares <= SHARE_EPSILON) {
    sharesSold = roundShares(openShares);
    remainingShares = 0;
  }

  return {
    ok: true,
    sharesSold,
    proceeds: roundMoney(sharesSold * price),
    realizedPnl: roundMoney((price - avgCost) * sharesSold),
    remainingShares,
    closes: remainingShares === 0,
  };
}
