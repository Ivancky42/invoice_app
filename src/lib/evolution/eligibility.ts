/**
 * Evidence bar a rule proposal must clear before a candidate row is created. PURE — no
 * prisma; the caller loads the rows and hands them over, so every rejection is unit-testable.
 *
 * The point of this module is to stop the engine from evolving on vibes. A proposal has to
 * (a) cite real, SCORED decisions, (b) cite ones that actually went wrong, (c) name what
 * would falsify it, (d) name a measurable success metric, and (e) not be a re-run of a
 * change that already failed. Loosening a rail costs strictly more evidence than tightening
 * one, because the failure mode of loosening is losing money and of tightening is missing out.
 */
import type { DecisionSignalQuality, DecisionVerdict } from "@/generated/prisma/client";

/** DecisionTypes that refuse to act — their "wrongness" is a counterfactual, not a P&L. */
const AVOID_TYPES = new Set(["AVOID", "WAIT", "DO_NOT_AVERAGE_DOWN"]);

/**
 * Terms a successMetric must name for it to be checkable later by `score_rule_version`.
 * Anything outside this list is unmeasurable prose ("the book should feel calmer").
 */
export const METRIC_ALLOWLIST = [
  "fitness",
  "return",
  "drawdown",
  "credit",
  "hit rate",
  "winrate",
  "win rate",
  "sessions",
  "z",
] as const;

/** Answers that are the ABSENCE of a counter-case rather than one. */
const NON_ANSWERS = new Set(["none", "n/a", "na", "-", "nil", "nothing"]);

const MIN_COUNTER_CASE_CHARS = 40;
const MIN_ROWS = 3;
const MIN_TICKERS = 2;
const MIN_ISO_WEEKS = 2;
const LOOSEN_MIN_ROWS = 5;
const LOOSEN_MIN_SPAN_DAYS = 42;
const REPROPOSAL_BAN_DAYS = 90;

export type EligibilityDecisionRow = {
  id: string;
  ticker: string | null;
  /** decisionDate when set, else the row's createdAt — the caller resolves the fallback. */
  decisionAt: Date | null;
  decisionType: string | null;
  finalVerdict: DecisionVerdict | null;
  signalQuality: DecisionSignalQuality | null;
  /**
   * Resolved counterfactual credit for this decision (SIGNED, NAV fraction) when one
   * exists. Negative = the refusal cost money, i.e. the avoid was wrong.
   */
  counterfactualCredit?: number | null;
};

export type RetiredVersionRow = {
  id: number;
  changedPaths: string[];
  retiredAt: Date | null;
  reasoningPattern: string | null;
};

export type EligibilityInput = {
  now: Date;
  rows: EligibilityDecisionRow[];
  counterCase: string;
  successMetric: string;
  reasoningPattern: string;
  /** True when ANY limits change moves in that parameter's looseningDirection. */
  loosens: boolean;
  worstCase?: string | null;
  changedPaths: string[];
  /** RETIRED/KILLED versions from the last 90 days. */
  recentlyRetired: RetiredVersionRow[];
  /** reasoningPattern values already retired (≥2 HURT versions share them). */
  retiredPatterns: string[];
};

export type EligibilityCode =
  | "insufficient_evidence"
  | "evidence_not_diverse"
  | "no_wrong_outcome"
  | "counter_case_missing"
  | "success_metric_not_measurable"
  | "loosening_evidence_bar"
  | "reproposal_banned"
  | "pattern_retired";

export type EligibilityStats = {
  scoredRows: number;
  tickers: number;
  isoWeeks: number;
  wrongOutcomes: number;
  spanDays: number;
};

export type EligibilityResult =
  | { ok: true; stats: EligibilityStats }
  | { ok: false; code: EligibilityCode; stats: EligibilityStats; detail?: Record<string, unknown> };

/**
 * Did this decision actually go wrong? Three independent ways, because the log records
 * three different kinds of decision:
 *  - an ACTED decision that lost money (finalVerdict LOSS);
 *  - any decision whose signal was retrospectively judged POOR;
 *  - a REFUSAL (AVOID / WAIT / DO_NOT_AVERAGE_DOWN) whose resolved counterfactual credit
 *    is negative — the name ran and staying out cost the book.
 *
 * AVOIDED_LOSS / WIN / NEUTRAL / TOO_EARLY are not wrong outcomes: TOO_EARLY in particular
 * is an unresolved verdict, and treating "not yet known" as evidence of failure would let
 * a proposal manufacture its own justification by citing fresh rows.
 */
export function wasWrongOutcome(
  row: EligibilityDecisionRow,
  counterfactualCredit?: number | null,
): boolean {
  if (row.finalVerdict === "LOSS") return true;
  if (row.signalQuality === "POOR") return true;
  const credit = counterfactualCredit ?? row.counterfactualCredit ?? null;
  if (
    row.decisionType !== null &&
    AVOID_TYPES.has(row.decisionType) &&
    typeof credit === "number" &&
    credit < 0
  ) {
    return true;
  }
  return false;
}

/** ISO-8601 week key ("2026-W32") — the diversity unit for evidence spread. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks are Mon..Sun and belong to the year containing their Thursday.
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** A successMetric is measurable when it names a NUMBER and an allowlisted metric term. */
export function isMeasurableMetric(successMetric: string): boolean {
  const text = successMetric.toLowerCase();
  if (!/\d/.test(text)) return false;
  return METRIC_ALLOWLIST.some((term) =>
    // "z" must be a standalone token ("z ≥ 2"), not the z inside "size".
    term === "z" ? /(^|[^a-z])z([^a-z]|$)/.test(text) : text.includes(term),
  );
}

export function hasCounterCase(counterCase: string): boolean {
  const trimmed = counterCase.trim();
  if (trimmed.length < MIN_COUNTER_CASE_CHARS) return false;
  return !NON_ANSWERS.has(trimmed.toLowerCase().replace(/[.\s]+$/, ""));
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/**
 * Full eligibility verdict. Checks run cheapest-and-most-fundamental first so the returned
 * code names the most basic thing that is wrong, not an incidental downstream one.
 */
export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const scored = input.rows.filter((r) => r.finalVerdict !== null);
  const dates = scored
    .map((r) => r.decisionAt)
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  const tickers = new Set(scored.map((r) => r.ticker).filter((t): t is string => !!t));
  const weeks = new Set(dates.map(isoWeekKey));
  const wrongOutcomes = scored.filter((r) => wasWrongOutcome(r)).length;
  const spanDays =
    dates.length >= 2
      ? daysBetween(
          new Date(Math.min(...dates.map((d) => d.getTime()))),
          new Date(Math.max(...dates.map((d) => d.getTime()))),
        )
      : 0;

  const stats: EligibilityStats = {
    scoredRows: scored.length,
    tickers: tickers.size,
    isoWeeks: weeks.size,
    wrongOutcomes,
    spanDays: Math.round(spanDays),
  };

  if (scored.length < MIN_ROWS) {
    return { ok: false, code: "insufficient_evidence", stats };
  }
  if (tickers.size < MIN_TICKERS || weeks.size < MIN_ISO_WEEKS) {
    return { ok: false, code: "evidence_not_diverse", stats };
  }
  if (wrongOutcomes < 1) {
    return { ok: false, code: "no_wrong_outcome", stats };
  }
  if (!hasCounterCase(input.counterCase)) {
    return { ok: false, code: "counter_case_missing", stats };
  }
  if (!isMeasurableMetric(input.successMetric)) {
    return {
      ok: false,
      code: "success_metric_not_measurable",
      stats,
      detail: { allowedTerms: [...METRIC_ALLOWLIST] },
    };
  }

  if (input.loosens) {
    const worstCase = (input.worstCase ?? "").trim();
    if (scored.length < LOOSEN_MIN_ROWS || spanDays < LOOSEN_MIN_SPAN_DAYS || !worstCase) {
      return {
        ok: false,
        code: "loosening_evidence_bar",
        stats,
        detail: {
          requiredRows: LOOSEN_MIN_ROWS,
          requiredSpanDays: LOOSEN_MIN_SPAN_DAYS,
          worstCaseProvided: worstCase.length > 0,
        },
      };
    }
  }

  if (input.reasoningPattern && input.retiredPatterns.includes(input.reasoningPattern)) {
    return {
      ok: false,
      code: "pattern_retired",
      stats,
      detail: { reasoningPattern: input.reasoningPattern },
    };
  }

  const proposedPaths = new Set(input.changedPaths);
  for (const version of input.recentlyRetired) {
    if (!version.retiredAt) continue;
    if (daysBetween(input.now, version.retiredAt) > REPROPOSAL_BAN_DAYS) continue;
    const overlap = version.changedPaths.filter((p) => proposedPaths.has(p));
    if (overlap.length === 0) continue;
    // The ban lifts only on evidence the failed version could not have seen.
    const hasNewEvidence = dates.some((d) => d.getTime() > version.retiredAt!.getTime());
    if (hasNewEvidence) continue;
    return {
      ok: false,
      code: "reproposal_banned",
      stats,
      detail: {
        blockedByVersionId: version.id,
        overlappingPaths: overlap,
        retiredAt: version.retiredAt.toISOString(),
      },
    };
  }

  return { ok: true, stats };
}
