/**
 * Server-side PAPER decision checks. Pure so the agent gets a corrective 400
 * in-run instead of a silent `no_position` reject at enqueue.
 */

export type PaperDecisionInput = {
  decisionType?: string | null;
  ticker?: string | null;
  convictionScore?: number | null;
};

export type PaperValidationError = {
  error: "paper_no_position" | "paper_already_held" | "paper_conviction_required";
  message: string;
};

const SKIP_TYPES = new Set(["HOLD", "WAIT", "AVOID", "DO_NOT_AVERAGE_DOWN"]);
const NEEDS_OPEN = new Set(["REDUCE", "EXIT", "ADD", "AVERAGE_DOWN"]);
const NEEDS_CONVICTION = new Set(["BUY", "ADD", "AVERAGE_DOWN"]);

/**
 * Validate a PAPER DecisionReview against the open paper tickers for that branch.
 * Returns null when the decision is allowed (or is a skip type / has no type).
 */
export function validatePaperDecision(
  input: PaperDecisionInput,
  openTickers: Set<string>,
): PaperValidationError | null {
  const decisionType = input.decisionType ?? null;
  if (!decisionType || SKIP_TYPES.has(decisionType)) return null;

  const ticker = input.ticker?.trim().toUpperCase() || null;
  const held = ticker !== null && openTickers.has(ticker);

  if (NEEDS_OPEN.has(decisionType) && !held) {
    return {
      error: "paper_no_position",
      message: ticker
        ? `The paper book does not hold ${ticker}. REDUCE / EXIT / ADD / AVERAGE_DOWN require an open paper position. Fix the ticker or decisionType and resubmit.`
        : "REDUCE / EXIT / ADD / AVERAGE_DOWN require a ticker the paper book already holds. Fix and resubmit.",
    };
  }

  if (decisionType === "BUY" && held) {
    return {
      error: "paper_already_held",
      message: `${ticker} is already an open paper position. Use ADD (not BUY) and resubmit.`,
    };
  }

  if (NEEDS_CONVICTION.has(decisionType)) {
    const score = input.convictionScore;
    if (score == null || !Number.isInteger(score) || score < 1 || score > 5) {
      return {
        error: "paper_conviction_required",
        message: `${decisionType} on the paper book requires convictionScore (1-5); sizing derives from it. Fix and resubmit.`,
      };
    }
  }

  return null;
}

/**
 * Idempotency key namespace: LIVE/REAL stays bare (existing keys keep replaying),
 * CANDIDATE is always `CANDIDATE:` (CANDIDATE rows are PAPER after the book backfill),
 * LIVE/PAPER is `LIVE:PAPER:` so a paper replay cannot collide with a real LIVE key.
 */
export function namespacedDecisionIdempotencyKey(
  rawKey: string,
  branch: "LIVE" | "CANDIDATE",
  book: "REAL" | "PAPER",
): string {
  if (branch === "CANDIDATE") return `CANDIDATE:${rawKey}`;
  if (book === "PAPER") return `LIVE:PAPER:${rawKey}`;
  return rawKey;
}
