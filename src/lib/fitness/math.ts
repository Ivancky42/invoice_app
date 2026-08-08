/**
 * Fitness maths. PURE — no prisma, no Config, no real-book state; every function here is
 * a total function of its arguments so the whole scoring rule is unit-testable.
 *
 * FRACTIONS THROUGHOUT: 0.03 means 3%. Nothing in this module (or its callers) carries a
 * `Pct` suffix or percentage points — the one fraction→pp conversion in the codebase
 * lives in src/lib/shadow/decisionReturns.ts and is not used here.
 */
import { roundFraction as roundToScale } from "@/lib/shadow/sizing";
import type { LimitsConfig } from "@/lib/stocks/config";

/**
 * Round to the 6-decimal scale every fraction column stores, collapsing −0 onto 0 so a
 * flat outcome never surfaces as a signed zero in a snapshot or an equality assertion.
 */
function roundFraction(value: number): number {
  const rounded = roundToScale(value);
  return rounded === 0 ? 0 : rounded;
}

// ---------------------------------------------------------------------------
// Counterfactual credit
// ---------------------------------------------------------------------------

export type CounterfactualCreditInput = {
  priceAtDecision: number;
  priceAtHorizon: number;
  /** Fraction of NAV the ruleset would have allowed in this name. */
  permittedSize: number;
};

export type CounterfactualCredit = {
  horizonReturn: number;
  /** SIGNED. Positive = the refusal saved money; negative = it cost money. */
  credit: number;
};

/**
 * Credit for a decision NOT taken.
 *
 * credit = −horizonReturn × permittedSize, SIGNED and never clamped or abs()'d.
 *
 * WHY signed: an unsigned (max(0, …)) credit would make "avoid everything" a free lunch —
 * every refusal would be worth ≥ 0, so evolution would be pushed towards blanket caution
 * and the ruleset would stop buying. The DEBIT side is the whole point: refusing a name
 * that then ran costs the branch exactly what it would have made, so caution is scored on
 * DISCRIMINATION (avoiding the right names), not on volume of refusals.
 */
export function counterfactualCredit({
  priceAtDecision,
  priceAtHorizon,
  permittedSize,
}: CounterfactualCreditInput): CounterfactualCredit {
  if (!Number.isFinite(priceAtDecision) || priceAtDecision <= 0) {
    throw new Error(`counterfactualCredit: invalid priceAtDecision ${priceAtDecision}`);
  }
  if (!Number.isFinite(priceAtHorizon) || priceAtHorizon <= 0) {
    throw new Error(`counterfactualCredit: invalid priceAtHorizon ${priceAtHorizon}`);
  }
  if (!Number.isFinite(permittedSize)) {
    throw new Error(`counterfactualCredit: invalid permittedSize ${permittedSize}`);
  }

  const horizonReturn = roundFraction(priceAtHorizon / priceAtDecision - 1);
  const credit = roundFraction(-horizonReturn * permittedSize);
  return { horizonReturn, credit };
}

// ---------------------------------------------------------------------------
// Permitted size (what the ruleset WOULD have allowed)
// ---------------------------------------------------------------------------

export type PermittedSizeInput = {
  limits: LimitsConfig;
  /** DecisionType of the refused decision (AVOID / WAIT / DO_NOT_AVERAGE_DOWN). */
  decisionType: string | null | undefined;
  conviction?: number | null;
  /** Sleeve of the name, when known. Only "SPECULATIVE" changes the answer. */
  sleeve?: string | null;
  /** Existing weight of this ticker in the branch's book (fraction of NAV). */
  currentWeight?: number;
  /** Aggregate weight already held in the SPECULATIVE sleeve (fraction of NAV). */
  speculativeSleeveWeight?: number;
};

/** Top of the tier band implied by a conviction score (unknown → smallest band). */
function bandForConviction(
  conviction: number | null | undefined,
  limits: LimitsConfig,
): number {
  const bands = limits.tierBands;
  if (conviction == null || !Number.isFinite(conviction)) return bands.TEST_STARTER[1];
  if (conviction >= 4) return bands.CONVICTION[1];
  if (conviction === 3) return bands.CONFIRMATION[1];
  return bands.TEST_STARTER[1];
}

/**
 * Fraction of NAV the branch's ruleset would have permitted for this name — the size the
 * counterfactual credit is scaled by.
 *
 * DO_NOT_AVERAGE_DOWN is sized as the INCREMENTAL add it refused, not as a fresh position:
 * the branch already holds `currentWeight`, so the only thing it declined was the top-up
 * to the confirmation band. Sizing it as a full position roughly TRIPLES every DNAD credit
 * (and debit) and would let one rule dominate the fitness signal.
 *
 * The single-position cap is applied as HEADROOM (cap − currentWeight) for EVERY decision
 * type, matching how a real buy is sized (src/lib/shadow/sizing.ts `buySizeFraction`):
 * refusing a name already held at 0.10 under a 0.15 cap only declined the 0.05 top-up, so
 * treating the cap as an absolute would over-credit (and over-debit) every held name.
 */
export function permittedSize({
  limits,
  decisionType,
  conviction,
  sleeve,
  currentWeight = 0,
  speculativeSleeveWeight = 0,
}: PermittedSizeInput): number {
  const held = Math.max(0, Number.isFinite(currentWeight) ? currentWeight : 0);

  let size =
    decisionType === "DO_NOT_AVERAGE_DOWN"
      ? Math.max(0, limits.tierBands.CONFIRMATION[1] - held)
      : bandForConviction(conviction, limits);

  size = Math.min(size, Math.max(0, limits.singlePositionPct - held));

  if (sleeve === "SPECULATIVE") {
    const sleeveHeld = Math.max(
      0,
      Number.isFinite(speculativeSleeveWeight) ? speculativeSleeveWeight : 0,
    );
    size = Math.min(size, Math.max(0, limits.speculativeSleevePct - sleeveHeld));
  }

  return roundFraction(Math.max(0, size));
}

// ---------------------------------------------------------------------------
// Return / risk primitives over a NAV series
// ---------------------------------------------------------------------------

/** Total return of a NAV series: last / first − 1. 0 when the series cannot support one. */
export function windowReturn(navSeries: number[]): number {
  if (navSeries.length < 2) return 0;
  const first = navSeries[0]!;
  const last = navSeries[navSeries.length - 1]!;
  if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(last)) return 0;
  return roundFraction(last / first - 1);
}

/** Worst peak-to-trough decline of a NAV series, as a positive fraction (never negative). */
export function maxDrawdown(navSeries: number[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const nav of navSeries) {
    if (!Number.isFinite(nav)) continue;
    if (nav > peak) peak = nav;
    if (peak > 0) {
      const dd = (peak - nav) / peak;
      if (dd > worst) worst = dd;
    }
  }
  return roundFraction(worst);
}

export type DrawdownPenaltyInput = {
  maxDrawdown: number;
  /** Drawdown this deep is free — equities move, and punishing noise breeds timidity. */
  freeBand?: number;
  weight?: number;
};

/** Non-negative penalty for drawdown beyond the free band. */
export function drawdownPenalty({
  maxDrawdown: dd,
  freeBand = 0.1,
  weight = 0.5,
}: DrawdownPenaltyInput): number {
  if (!Number.isFinite(dd)) return 0;
  return roundFraction(Math.max(0, dd - freeBand) * weight);
}

/**
 * Frictional cost of a session's fills as a fraction of NAV: Σ|notional| × rate / startNav.
 * Non-negative; a non-positive startNav yields 0 rather than a divide-by-zero.
 */
export function turnoverCost(
  fillNotionals: number[],
  startNav: number,
  rate = 0.001,
): number {
  if (!Number.isFinite(startNav) || startNav <= 0) return 0;
  let gross = 0;
  for (const notional of fillNotionals) {
    if (Number.isFinite(notional)) gross += Math.abs(notional);
  }
  return roundFraction(Math.max(0, (gross * rate) / startNav));
}

// ---------------------------------------------------------------------------
// The fitness function
// ---------------------------------------------------------------------------

export type FitnessInput = {
  shadowReturn: number;
  /** Signed avoided-loss credit (see {@link counterfactualCredit}). */
  avoidedCredit: number;
  drawdownPenalty: number;
  turnoverCost: number;
  /** Benchmark (CSPX) return over the same window — subtracted, so this is EXCESS fitness. */
  benchmarkReturn: number;
};

/**
 * fitness = shadowReturn + avoidedCredit − drawdownPenalty − turnoverCost − benchmarkReturn
 *
 * Benchmark subtraction is what stops a rising tide from being read as skill: a branch that
 * made 3% while CSPX made 5% scores negative.
 */
export function fitness({
  shadowReturn,
  avoidedCredit,
  drawdownPenalty: penalty,
  turnoverCost: turnover,
  benchmarkReturn,
}: FitnessInput): number {
  return roundFraction(
    shadowReturn + avoidedCredit - penalty - turnover - benchmarkReturn,
  );
}

// ---------------------------------------------------------------------------
// Sequential test
// ---------------------------------------------------------------------------

export type SequentialZ = {
  /** Mean per-session increment. */
  delta: number;
  se: number;
  z: number | null;
  n: number;
};

/**
 * z-score of a candidate's edge from PER-SESSION increments.
 *
 * The increments are (approximately) i.i.d., so se = sd/√n is honest. Differencing the
 * ROLLING 30-session LEVEL instead would overlap 29 of 30 sessions between consecutive
 * observations, which understates the standard error by roughly √30 and manufactures
 * significance — this is the corrected form.
 *
 * n < 2 or a degenerate (zero) standard error → z is null; a null z can never promote.
 */
export function sequentialZ(dailyDeltas: number[]): SequentialZ {
  const values = dailyDeltas.filter((v) => Number.isFinite(v));
  const n = values.length;
  if (n === 0) return { delta: 0, se: 0, z: null, n: 0 };

  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  if (n < 2) return { delta: mean, se: 0, z: null, n };

  const variance =
    values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / (n - 1);
  const se = Math.sqrt(variance) / Math.sqrt(n);
  if (se === 0 || !Number.isFinite(se)) return { delta: mean, se: 0, z: null, n };

  return { delta: mean, se, z: mean / se, n };
}

// ---------------------------------------------------------------------------
// Candidate verdict
// ---------------------------------------------------------------------------

export type CandidateVerdict =
  | "HARD_REVERT"
  | "EARLY_KILL"
  | "PROMOTE"
  | "INCONCLUSIVE"
  | "CONTINUE";

export type EvaluateCandidateInput = {
  z: number | null;
  sessions: number;
  decisions: number;
  lane: "FAST" | "SLOW";
  candidateMaxDrawdown: number;
  liveMaxDrawdown: number;
  /** Kernel floor: drawdown past this reverts regardless of any other evidence. */
  kernelDrawdownFloor?: number;
  /** Drawdown of the branch under test (the kernel check reads this, not the candidate's). */
  branchMaxDrawdown: number;
  promotionsIn90d: number;
  rateLimit?: number;
};

/**
 * Absolute floor under the candidate-vs-live drawdown gate.
 *
 * The gate is relative (candidate ≤ live × 1.25), which degenerates to `≤ 0` whenever LIVE
 * has never drawn down — in a rising tape that would block EVERY promotion forever, since
 * any candidate that ever ticked down fails. The floor lets a candidate take a genuinely
 * small drawdown (≤ 5%) even against a scratchless live book; the kernel drawdown floor
 * still governs anything deep.
 */
export const DRAWDOWN_GATE_FLOOR = 0.05;

/** Minimum evidence a lane must accumulate before a promotion is even considered. */
const LANE_MINIMUMS = {
  FAST: { sessions: 10, decisions: 10 },
  SLOW: { sessions: 30, decisions: 20 },
} as const;

/**
 * Verdict on a candidate ruleset. Precedence is fixed and deliberate:
 *
 *   HARD_REVERT → EARLY_KILL → PROMOTE → INCONCLUSIVE → CONTINUE
 *
 * The kernel drawdown floor is checked FIRST and beats any z-score: a book that has blown
 * through the floor is reverted even if it looks brilliant, because the statistic cannot
 * un-lose the capital. A null z can only ever CONTINUE (or HARD_REVERT).
 */
export function evaluateCandidate({
  z,
  sessions,
  decisions,
  lane,
  candidateMaxDrawdown,
  liveMaxDrawdown,
  kernelDrawdownFloor = 0.25,
  branchMaxDrawdown,
  promotionsIn90d,
  rateLimit = 8,
}: EvaluateCandidateInput): CandidateVerdict {
  if (branchMaxDrawdown > kernelDrawdownFloor) return "HARD_REVERT";

  if (sessions >= 10 && z !== null && z <= -1.5) return "EARLY_KILL";

  if (z !== null && z >= 2.0) {
    const minimums = LANE_MINIMUMS[lane];
    const enoughEvidence =
      sessions >= minimums.sessions && decisions >= minimums.decisions;
    const riskOk =
      candidateMaxDrawdown <= Math.max(liveMaxDrawdown * 1.25, DRAWDOWN_GATE_FLOOR);
    const underRateLimit = promotionsIn90d < rateLimit;
    if (enoughEvidence && riskOk && underRateLimit) return "PROMOTE";
  }

  if (sessions >= 60) return "INCONCLUSIVE";
  return "CONTINUE";
}

// ---------------------------------------------------------------------------
// Move attribution
// ---------------------------------------------------------------------------

export type MoveClass = "MARKET_MOVE" | "THEME_MOVE" | "IDIOSYNCRATIC" | "INSUFFICIENT_DATA";

export type ClassifyMoveInput = {
  /** Fraction of the tracked universe moving the same way. */
  breadth: number;
  /** Fraction of the name's theme moving the same way. */
  themeBreadth: number;
  /** The name's move beyond its theme's (signed fraction). */
  excessMove: number;
  /** True when tier-1/2 (primary) evidence explains the move. */
  hasTier12Evidence: boolean;
  /** Names the breadth figures were computed over. */
  sampleSize: number;
  breadthMarketThreshold: number;
  themeBreadthThreshold: number;
  excessMoveIdiosyncratic: number;
};

/**
 * Attribute a price move to the market, the theme, or the name itself.
 *
 * Order matters: a thin sample says nothing at all, and market-wide breadth outranks a
 * theme reading, because in a broad tape every theme looks like it is moving.
 */
export function classifyMove({
  breadth,
  themeBreadth,
  excessMove,
  hasTier12Evidence,
  sampleSize,
  breadthMarketThreshold,
  themeBreadthThreshold,
  excessMoveIdiosyncratic,
}: ClassifyMoveInput): MoveClass {
  if (sampleSize < 10) return "INSUFFICIENT_DATA";
  if (breadth >= breadthMarketThreshold) return "MARKET_MOVE";
  if (themeBreadth >= themeBreadthThreshold) return "THEME_MOVE";
  if (Math.abs(excessMove) >= excessMoveIdiosyncratic || hasTier12Evidence) {
    return "IDIOSYNCRATIC";
  }
  return "MARKET_MOVE";
}

// ---------------------------------------------------------------------------
// Parameter drift guard
// ---------------------------------------------------------------------------

export type DriftCode = "HARD_RANGE" | "DRIFT_90D" | "DRIFT_V1" | "CONSECUTIVE_LOOSENING";

export type DriftGuardInput = {
  /** e.g. "limits.singlePositionPct" — carried for the caller's error message. */
  paramPath: string;
  hardRange: [number, number];
  proposed: number;
  valueAt90dAgo: number;
  valueAtV1: number;
  consecutiveLoosenings: number;
  /** Which direction of change loosens THIS parameter. */
  looseningDirection: "UP" | "DOWN";
};

export type DriftGuardResult = { allowed: boolean; code?: DriftCode };

/** Relative drift beyond this fraction of the 90-day-ago value is refused. */
const DRIFT_90D_LIMIT = 0.3;
/** Relative drift beyond this fraction of the v1 value is refused. */
const DRIFT_V1_LIMIT = 0.6;
/** Loosenings in a row after which the parameter must hold still. */
const CONSECUTIVE_LOOSENING_LIMIT = 3;
/**
 * Baselines this close to zero carry no RELATIVE rail: `x% of 0` is 0, so any non-zero
 * proposal would be refused forever with a misleading DRIFT code (a parameter that was
 * genuinely 0 could never be turned on). Below the epsilon the hard range is the only
 * check — it is an absolute wall and is still enforced.
 */
const DRIFT_EPSILON = 1e-9;

/**
 * Ratchet guard on a single ruleset parameter. Checks run in order, hardest first: the
 * absolute range is a wall, the two drift rails limit speed against recent and original
 * values, and the loosening counter stops evolution from walking a limit out one small,
 * individually-defensible step at a time.
 */
export function driftGuard({
  hardRange,
  proposed,
  valueAt90dAgo,
  valueAtV1,
  consecutiveLoosenings,
  looseningDirection,
}: DriftGuardInput): DriftGuardResult {
  const [lo, hi] = hardRange;
  if (!Number.isFinite(proposed) || proposed < lo || proposed > hi) {
    return { allowed: false, code: "HARD_RANGE" };
  }

  if (
    Math.abs(valueAt90dAgo) >= DRIFT_EPSILON &&
    Math.abs(proposed - valueAt90dAgo) > DRIFT_90D_LIMIT * Math.abs(valueAt90dAgo)
  ) {
    return { allowed: false, code: "DRIFT_90D" };
  }

  if (
    Math.abs(valueAtV1) >= DRIFT_EPSILON &&
    Math.abs(proposed - valueAtV1) > DRIFT_V1_LIMIT * Math.abs(valueAtV1)
  ) {
    return { allowed: false, code: "DRIFT_V1" };
  }

  const loosens =
    looseningDirection === "UP" ? proposed > valueAt90dAgo : proposed < valueAt90dAgo;
  if (consecutiveLoosenings >= CONSECUTIVE_LOOSENING_LIMIT && loosens) {
    return { allowed: false, code: "CONSECUTIVE_LOOSENING" };
  }

  return { allowed: true };
}
