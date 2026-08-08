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

export type BuySizing =
  | { ok: true; sizeFraction: number; capped: boolean }
  | { ok: false; reason: "position_cap" };

/**
 * Fraction of NAV to buy. `currentFraction` is the ticker's existing open weight, so an
 * ADD is clamped to the headroom under `singlePositionPct`; already at/above the cap
 * rejects rather than silently sizing to zero.
 */
export function buySizeFraction(
  conviction: number | null | undefined,
  currentFraction: number,
  limits: LimitsConfig,
): BuySizing {
  const cap = limits.singlePositionPct;
  const headroom = roundFraction(cap - Math.max(0, currentFraction));
  if (headroom <= 0) return { ok: false, reason: "position_cap" };

  const target = targetFractionForConviction(conviction, limits);
  const sizeFraction = roundFraction(Math.min(target, headroom));
  if (sizeFraction <= 0) return { ok: false, reason: "position_cap" };
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
