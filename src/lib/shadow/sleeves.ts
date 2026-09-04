/**
 * Shared sleeve lookup for paper sizing and counterfactual permitted-size.
 *
 * Sleeve for a ticker comes from the shared Portfolio row. Watchlist has no
 * `sleeve` column, so a name with no Portfolio sleeve is UNASSIGNED — not
 * speculative — matching `get_context(book=PAPER)` metadata join.
 */
import { prisma } from "@/lib/prisma";

export async function loadSharedSleeves(): Promise<Map<string, string>> {
  const rows = await prisma.portfolio.findMany({
    select: { ticker: true, sleeve: true },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.sleeve) map.set(row.ticker.trim().toUpperCase(), row.sleeve);
  }
  return map;
}
