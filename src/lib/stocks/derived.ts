/**
 * Derived UI helpers from numeric fields (not Notion select strings).
 * Thresholds come from Config in production; DEFAULT_* exist only as
 * unit/fallback when Config is empty.
 */

export type DerivedSentiment = "VERY_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH";
export type DerivedEarningsRisk = "IMMINENT" | "SOON" | "CLEAR";

export type SentimentThresholds = {
  /** score >= veryBullish → VERY_BULLISH */
  veryBullish: number;
  /** score >= bullish → BULLISH */
  bullish: number;
  /** score >= neutral → NEUTRAL; else BEARISH */
  neutral: number;
};

export type EarningsRiskThresholds = {
  /** days <= imminentMaxDays → IMMINENT */
  imminentMaxDays: number;
  /** days <= soonMaxDays → SOON; else CLEAR */
  soonMaxDays: number;
};

/** @deprecated Prefer Config via getSentimentThresholds(); fallback only. */
export const DEFAULT_SENTIMENT: SentimentThresholds = {
  veryBullish: 80,
  bullish: 60,
  neutral: 40,
};

/** @deprecated Prefer Config via getEarningsRiskThresholds(); fallback only. */
export const DEFAULT_EARNINGS_RISK: EarningsRiskThresholds = {
  imminentMaxDays: 13,
  soonMaxDays: 45,
};

/** Extremely Bullish / Bullish / Neutral / Bearish from social score cutoffs. */
export function sentimentFromScore(
  score: number | null,
  thresholds: SentimentThresholds = DEFAULT_SENTIMENT,
): DerivedSentiment | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= thresholds.veryBullish) return "VERY_BULLISH";
  if (score >= thresholds.bullish) return "BULLISH";
  if (score >= thresholds.neutral) return "NEUTRAL";
  return "BEARISH";
}

/** Imminent / Soon / Clear from days-to-earnings cutoffs. */
export function earningsRiskFromDays(
  days: number | null,
  thresholds: EarningsRiskThresholds = DEFAULT_EARNINGS_RISK,
): DerivedEarningsRisk | null {
  if (days == null || !Number.isFinite(days)) return null;
  if (days <= thresholds.imminentMaxDays) return "IMMINENT";
  if (days <= thresholds.soonMaxDays) return "SOON";
  return "CLEAR";
}
