/**
 * Dedupe DecisionReviews before they become fitness-facing shadow rows.
 *
 * - Prefer Notion-backed rows over migration `seed-*` near-twins (same ticker + type,
 *   decisionDate within ±1 calendar day).
 * - Drop later rows that share a `notionId` with an earlier kept row (defense in depth;
 *   the Notion sync unique path should already prevent this).
 */
import { ymd } from "@/lib/shadow/sessions";

export type DedupeDecisionInput = {
  id: string;
  ticker: string | null;
  decisionType: string | null;
  decisionDate: Date | null;
  notionId: string | null;
  idempotencyKey: string | null;
};

const SEED_KEY_PREFIX = "seed-";

/** Absolute calendar-day distance between two YYYY-MM-DD strings, or null if either missing. */
export function calendarDayDistance(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return Math.abs(Math.round(ms / 86_400_000));
}

export function isSeedIdempotencyKey(key: string | null | undefined): boolean {
  if (!key) return false;
  // LIVE keeps bare keys; CANDIDATE prefixes with `CANDIDATE:`.
  const bare = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  return bare.startsWith(SEED_KEY_PREFIX);
}

/**
 * Filter a chronologically-sorted (or any-order) DR list down to rows that should enter
 * the shadow ledger / counterfactual stream.
 *
 * Notion wins over seed near-twins. When both are Notion-backed with the same notionId,
 * the first encounter wins.
 */
export function dedupeDecisionsForShadow<T extends DedupeDecisionInput>(rows: T[]): T[] {
  const byNotionId = new Map<string, T>();
  const notionByTickerType = new Map<string, T[]>();

  // First pass: index Notion-backed rows so seed near-twins can be detected regardless of
  // encounter order.
  for (const row of rows) {
    if (!row.notionId) continue;
    if (!byNotionId.has(row.notionId)) byNotionId.set(row.notionId, row);
    const ticker = row.ticker?.trim().toUpperCase();
    if (!ticker || !row.decisionType) continue;
    const key = `${ticker}|${row.decisionType}`;
    const list = notionByTickerType.get(key) ?? [];
    list.push(row);
    notionByTickerType.set(key, list);
  }

  const kept: T[] = [];
  const keptNotionIds = new Set<string>();

  for (const row of rows) {
    if (row.notionId) {
      // Same notionId twice: keep the first (already indexed), skip later clones.
      if (keptNotionIds.has(row.notionId)) continue;
      if (byNotionId.get(row.notionId)?.id !== row.id) continue;
      keptNotionIds.add(row.notionId);
      kept.push(row);
      continue;
    }

    if (isSeedIdempotencyKey(row.idempotencyKey)) {
      const ticker = row.ticker?.trim().toUpperCase();
      if (ticker && row.decisionType) {
        const seedDay = row.decisionDate ? ymd(row.decisionDate) : null;
        const twins = notionByTickerType.get(`${ticker}|${row.decisionType}`) ?? [];
        const nearTwin = twins.some((n) => {
          const notionDay = n.decisionDate ? ymd(n.decisionDate) : null;
          const dist = calendarDayDistance(seedDay, notionDay);
          return dist !== null && dist <= 1;
        });
        if (nearTwin) continue;
      }
    }

    kept.push(row);
  }

  return kept;
}
