import { prisma } from "@/lib/prisma";
import { syncPortfolio } from "@/lib/notion/mappers/portfolio";
import { syncWatchlist } from "@/lib/notion/mappers/watchlist";
import { syncTrades } from "@/lib/notion/mappers/trades";
import { syncTrends } from "@/lib/notion/mappers/trends";
import { syncIdeas } from "@/lib/notion/mappers/ideas";
import { syncDailyLogs } from "@/lib/notion/mappers/dailyLogs";

const SYNC_SOURCE = "notion";

export type SyncStep = { name: string; count?: number; ok: boolean; error?: string };

export type SyncResult = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  results: Record<string, number | null>;
  errors?: string[];
};

async function runStep(
  name: string,
  fn: () => Promise<{ count: number }>,
): Promise<SyncStep> {
  try {
    const { count } = await fn();
    return { name, count, ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[notion-sync] ${name} failed:`, msg);
    return { name, ok: false, error: msg };
  }
}

/**
 * Run all Notion → Neon syncs sequentially (rate limit: 3 req/s) and
 * record the outcome on the shared `SyncStatus` row. Always resolves —
 * partial failures are reflected in `errors` and `lastError`, never thrown.
 */
export async function runNotionSync(): Promise<SyncResult> {
  const startedAt = new Date();
  await prisma.syncStatus.upsert({
    where: { source: SYNC_SOURCE },
    create: { source: SYNC_SOURCE, lastRunAt: startedAt },
    update: { lastRunAt: startedAt, lastError: null },
  });

  const steps: SyncStep[] = [];
  steps.push(await runStep("portfolio", syncPortfolio));
  steps.push(await runStep("watchlist", syncWatchlist));
  steps.push(await runStep("trades", syncTrades));
  steps.push(await runStep("trends", syncTrends));
  steps.push(await runStep("ideas", syncIdeas));
  steps.push(await runStep("dailyLogs", syncDailyLogs));

  const allOk = steps.every((s) => s.ok);
  const rowCounts: Record<string, number | null> = {};
  for (const s of steps) rowCounts[s.name] = s.count ?? null;
  const errors = steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.error}`);
  const completedAt = new Date();

  await prisma.syncStatus.update({
    where: { source: SYNC_SOURCE },
    data: {
      lastSuccessAt: allOk ? completedAt : undefined,
      lastError: errors.length ? errors.join(" | ") : null,
      rowCounts,
    },
  });

  return {
    ok: allOk,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    results: rowCounts,
    errors: errors.length ? errors : undefined,
  };
}
