/**
 * DecisionType → shadow order intent. PURE — no prisma.
 *
 * Only decisions that change exposure become paper orders. HOLD / WAIT / AVOID /
 * DO_NOT_AVERAGE_DOWN are counterfactual-only: they are recorded as decisions but move
 * no shares, so enqueuing anything for them would fabricate trades the routine never made.
 */
import type { DecisionType } from "@/generated/prisma/enums";

export type OrderIntent =
  /** Not an exposure-changing decision — no order at all. */
  | { kind: "none" }
  /** Open or increase: sized from conviction, capped by singlePositionPct headroom. */
  | { kind: "buy" }
  /** Reduce/close: `portion` is the fraction of the open position to liquidate. */
  | { kind: "sell"; portion: number };

const NONE: OrderIntent = { kind: "none" };
const BUY: OrderIntent = { kind: "buy" };

/**
 * What to do with a SELL-side decision, given the branch's state for that ticker.
 *
 *  - `enqueue`        — there is an open position to reduce/close.
 *  - `defer`          — no position YET, but a BUY for the same ticker is still PENDING.
 *                       Rejecting here would be wrong twice over: the routine did decide
 *                       to exit, and the pending BUY is about to create the position it
 *                       wanted out of. Leaving the decision un-enqueued makes the next
 *                       run reconsider it once the BUY fills (or is rejected).
 *  - `reject_no_position` — neither a position nor a pending BUY: nothing to sell, ever.
 */
export type SellDisposition = "enqueue" | "defer" | "reject_no_position";

/** PURE. `openShares` is the branch's open share count for the ticker (0 when flat). */
export function sellDisposition(openShares: number, hasPendingBuy: boolean): SellDisposition {
  if (openShares > 0) return "enqueue";
  return hasPendingBuy ? "defer" : "reject_no_position";
}

/** Classification table for every DecisionType value (exhaustive by design). */
export function classifyDecisionType(
  decisionType: DecisionType | null | undefined,
): OrderIntent {
  switch (decisionType) {
    case "BUY":
    case "ADD":
    case "AVERAGE_DOWN":
      return BUY;
    case "REDUCE":
      // "Trim" in the prompts — half the open position.
      return { kind: "sell", portion: 0.5 };
    case "EXIT":
      return { kind: "sell", portion: 1 };
    case "HOLD":
    case "WAIT":
    case "AVOID":
    case "DO_NOT_AVERAGE_DOWN":
      return NONE;
    default:
      // Null decisionType (or a value added to the enum later) is not tradeable.
      return NONE;
  }
}
