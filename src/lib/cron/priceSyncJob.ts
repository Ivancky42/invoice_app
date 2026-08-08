import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runPriceSyncToNeon, type PriceSyncResult } from "@/lib/stocks/priceSync";
import { recordPortfolioSnapshot } from "@/lib/stocks/recordPortfolioSnapshot";

const SYNC_SOURCE = "prices";

/** Everything the snapshot step needs from a price sync run. */
export type PriceSyncSummary = Pick<
  PriceSyncResult,
  "ok" | "updated" | "skipped" | "failed" | "errors" | "details"
>;

export type FailedDetail = {
  table: string;
  ticker: string | null | undefined;
  error: string;
};

export type PortfolioSnapshotOutcome = {
  /** Price sync ok AND the snapshot did not throw. */
  allOk: boolean;
  /** null when the snapshot was not attempted (price sync too broken). */
  snapshotOk: boolean | null;
  errors: string[];
  failedTickers: string[];
  failedDetails: FailedDetail[];
};

const priceSyncDetailSchema = z.object({
  table: z.enum(["portfolio", "watchlist", "ideas"]),
  id: z.string(),
  tickerHint: z.string().nullable(),
  symbolUsed: z.string().nullable(),
  ok: z.boolean(),
  error: z.string().optional(),
  price: z.number().optional(),
});

const priceSyncSummarySchema = z.object({
  ok: z.boolean(),
  updated: z.number(),
  skipped: z.number(),
  failed: z.number(),
  errors: z.array(z.string()),
  details: z.array(priceSyncDetailSchema),
});

/** Marks SyncStatus{source:"prices"} as running, then syncs prices into Neon. */
export async function runPriceSyncStep(): Promise<PriceSyncResult> {
  const startedAt = new Date();
  await prisma.syncStatus.upsert({
    where: { source: SYNC_SOURCE },
    create: { source: SYNC_SOURCE, lastRunAt: startedAt },
    update: { lastRunAt: startedAt, lastError: null },
  });

  return runPriceSyncToNeon();
}

/**
 * Snapshot gate + SyncStatus finalize — the second half of the manual
 * `/api/sync/prices` flow, shared with the `portfolio_snapshot` cron job so the
 * two can't drift.
 */
export async function runPortfolioSnapshotStep(
  result: PriceSyncSummary,
): Promise<PortfolioSnapshotOutcome> {
  let snapshotOk: boolean | null = null;
  const errors = [...result.errors];
  let snapshotThrew = false;

  if (result.updated > 0 || result.failed === 0) {
    if (result.updated > 0 && result.failed > 0) {
      errors.push(
        `portfolioSnapshot: recording after partial price sync (updated=${result.updated}, failed=${result.failed})`,
      );
      console.warn(
        `[sync/prices] partial success: updated=${result.updated} failed=${result.failed}; recording portfolio snapshot`,
      );
    }
    try {
      const snap = await recordPortfolioSnapshot();
      snapshotOk = snap.ok;
      if (!snap.ok) {
        // Prices succeeded; empty/zero portfolio just means no snapshot row.
        errors.push("portfolioSnapshot: skipped (totalValue <= 0)");
      }
    } catch (e) {
      snapshotThrew = true;
      snapshotOk = false;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`portfolioSnapshot: ${msg}`);
    }
  }

  const allOk = result.ok && !snapshotThrew;
  const completedAt = new Date();

  const failedDetails = failedDetailsOf(result);
  const failedTickers = failedTickersOf(failedDetails);

  await prisma.syncStatus.update({
    where: { source: SYNC_SOURCE },
    data: {
      lastSuccessAt: allOk ? completedAt : undefined,
      lastError: allOk ? null : errors.length ? errors.join(" | ") : null,
      rowCounts: {
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        portfolioSnapshot: snapshotOk === null ? null : snapshotOk ? 1 : 0,
        failedTickers,
        failedDetails: failedDetails.slice(0, 40),
      },
    },
  });

  return { allOk, snapshotOk, errors, failedTickers, failedDetails };
}

export function failedDetailsOf(result: PriceSyncSummary): FailedDetail[] {
  return result.details
    .filter((d) => !d.ok)
    .map((d) => ({
      table: d.table,
      ticker: d.tickerHint,
      error: d.error ?? "unknown",
    }));
}

export function failedTickersOf(failedDetails: FailedDetail[]): string[] {
  return [
    ...new Set(
      failedDetails
        .map((d) => d.ticker?.trim().toUpperCase())
        .filter((t): t is string => Boolean(t)),
    ),
  ];
}

/**
 * Compact, JSON-safe summary stored on the `price_sync` JobRun so the
 * `portfolio_snapshot` job can finish the bookkeeping. Only failed details are
 * kept — the snapshot step never reads successful ones.
 */
export function toPriceSyncLedgerDetail(result: PriceSyncResult): PriceSyncSummary {
  return {
    ok: result.ok,
    updated: result.updated,
    skipped: result.skipped,
    failed: result.failed,
    errors: result.errors,
    details: result.details.filter((d) => !d.ok),
  };
}

/** Parses a `price_sync` JobRun detail back into a summary; null when unusable. */
export function parsePriceSyncLedgerDetail(value: unknown): PriceSyncSummary | null {
  const parsed = priceSyncSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
