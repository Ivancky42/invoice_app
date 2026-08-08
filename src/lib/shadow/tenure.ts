/**
 * Post-reset tenure floors for enqueue / counterfactual seed.
 *
 * `createdAt >= resetAt` alone is not enough: a freshly synced DecisionReview can carry
 * an old `decisionDate` and would backfill historical fills/credits into a clean book.
 *
 * Compare calendar days (not "latest session on or before"): a weekend/holiday reset
 * must not slide the floor back to Friday and re-admit pre-reset decisionDates.
 */
import {
  decisionAsOfDay,
  easternDateOf,
  type DecisionAsOfInput,
} from "@/lib/shadow/sessions";

/** Keep only decisions dated on/after the reset's Eastern calendar day. */
export function filterDecisionsAfterReset<T extends DecisionAsOfInput>(
  _sessions: string[],
  decisions: T[],
  resetAt: Date | null | undefined,
): T[] {
  if (!resetAt) return decisions;
  const floorDay = easternDateOf(resetAt);
  return decisions.filter((d) => decisionAsOfDay(d) >= floorDay);
}
