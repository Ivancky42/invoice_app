/**
 * Position sizing for shadow (paper) orders. PURE — no prisma, no Config.
 * Limits come from the branch's own ruleset (`getRuleSet(branch).limits`), never from
 * the live Config, so a candidate ruleset is sized by its own numbers.
 */
import type { LimitsConfig } from "@/lib/stocks/config";

/** `sizeFraction` is Decimal(8,6) — round every fraction to that scale before writing. */
export function roundFraction(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Target weight for a new/increased position from the conviction score.
 * Top of the tier band (the band's stretch size) per `_shared` §5:
 * 1–2 → TEST_STARTER, 3 → CONFIRMATION, 4–5 → CONVICTION, unknown → TEST_STARTER.
 */
export function targetFractionForConviction(
  conviction: number | null | undefined,
  limits: LimitsConfig,
): number {
  const bands = limits.tierBands;
  if (conviction == null || !Number.isFinite(conviction)) return bands.TEST_STARTER[1];
  if (conviction >= 4) return bands.CONVICTION[1];
  if (conviction === 3) return bands.CONFIRMATION[1];
  return bands.TEST_STARTER[1];
}

export type BuySizingContext = {
  /** Available cash / NAV (pending BUY notionals already subtracted). Default 1. */
  cashFraction?: number;
  /** Shared metadata sleeve. Only `"SPECULATIVE"` binds the sleeve cap. */
  sleeve?: string | null;
  /** Current SPECULATIVE-sleeve weight including this ticker if already held. */
  speculativeSleeveWeight?: number;
};

export type BuyRejectReason = "position_cap" | "cash_floor" | "sleeve_cap";

export type BuySizing =
  | { ok: true; sizeFraction: number; capped: boolean }
  | { ok: false; reason: BuyRejectReason };

/**
 * Fraction of NAV to buy. `currentFraction` is the ticker's existing open weight, so an
 * ADD is clamped to the headroom under `singlePositionPct`; already at/above the cap
 * rejects rather than silently sizing to zero.
 *
 * A BUY may not take paper cash below `cashFloorPct × NAV` (shrink, or `cash_floor`
 * when nothing is left). SPECULATIVE names are also clamped so sleeve weight including
 * the new order stays ≤ `speculativeSleevePct` (`sleeve_cap` when no headroom).
 * UNASSIGNED / non-speculative sleeves skip the sleeve gate.
 */
export function buySizeFraction(
  conviction: number | null | undefined,
  currentFraction: number,
  limits: LimitsConfig,
  ctx: BuySizingContext = {},
): BuySizing {
  const cap = limits.singlePositionPct;
  const positionHeadroom = roundFraction(cap - Math.max(0, currentFraction));
  if (positionHeadroom <= 0) return { ok: false, reason: "position_cap" };

  const target = targetFractionForConviction(conviction, limits);
  let sizeFraction = Math.min(target, positionHeadroom);
  let bound: BuyRejectReason = "position_cap";

  const cashFraction = Number.isFinite(ctx.cashFraction) ? (ctx.cashFraction as number) : 1;
  const cashHeadroom = cashFraction - limits.cashFloorPct;
  if (cashHeadroom < sizeFraction) {
    sizeFraction = cashHeadroom;
    bound = "cash_floor";
  }
  if (sizeFraction <= 0) return { ok: false, reason: "cash_floor" };

  if (ctx.sleeve === "SPECULATIVE") {
    const sleeveHeld = Math.max(
      0,
      Number.isFinite(ctx.speculativeSleeveWeight) ? (ctx.speculativeSleeveWeight as number) : 0,
    );
    const sleeveHeadroom = limits.speculativeSleevePct - sleeveHeld;
    if (sleeveHeadroom < sizeFraction) {
      sizeFraction = sleeveHeadroom;
      bound = "sleeve_cap";
    }
    if (sizeFraction <= 0) return { ok: false, reason: "sleeve_cap" };
  }

  sizeFraction = roundFraction(sizeFraction);
  if (sizeFraction <= 0) return { ok: false, reason: bound };
  return { ok: true, sizeFraction, capped: sizeFraction < target };
}

/**
 * Fraction of the OPEN POSITION a sell liquidates (1 = full exit), clamped to [0, 1].
 * Sells are sized against the position rather than NAV so a full exit closes exactly,
 * whatever the mark did between enqueue and fill.
 */
export function sellSizeFraction(portion: number): number {
  if (!Number.isFinite(portion) || portion <= 0) return 0;
  return roundFraction(Math.min(1, portion));
}
