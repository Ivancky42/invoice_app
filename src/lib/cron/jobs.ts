import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  parsePriceSyncLedgerDetail,
  runPortfolioSnapshotStep,
  runPriceSyncStep,
  toPriceSyncLedgerDetail,
} from "@/lib/cron/priceSyncJob";
import type { Cadence } from "@/lib/cron/schedule";
import { runPriceHistorySync } from "@/lib/pricehistory/sync";

/** Remaining wall-clock the tick is willing to spend, checked by long jobs. */
export type Budget = {
  remainingMs: () => number;
};

export type JobContext = {
  /** UTC calendar day this tick is running for. */
  runDay: Date;
  /** Cursor persisted by a previous, unfinished run of this job. */
  cursor: Prisma.JsonValue | null;
  budget: Budget;
};

export type JobResult = {
  /** false → the runner persists `cursor` and chains another tick. */
  done: boolean;
  cursor?: Prisma.InputJsonValue;
  detail?: Prisma.InputJsonValue;
};

export type CronJob = {
  job: string;
  cadence: Cadence;
  dependsOn: string[];
  run(ctx: JobContext): Promise<JobResult>;
};

export const PRICE_SYNC_JOB = "price_sync";
export const PORTFOLIO_SNAPSHOT_JOB = "portfolio_snapshot";
export const PRICE_HISTORY_JOB = "price_history";

/**
 * Ordered cron registry. Later commits append jobs here; order is the run
 * order, `dependsOn` is the hard gate.
 */
export const CRON_JOBS: CronJob[] = [
  {
    job: PRICE_SYNC_JOB,
    cadence: "daily",
    dependsOn: [],
    async run() {
      const result = await runPriceSyncStep();
      return {
        done: true,
        detail: toPriceSyncLedgerDetail(result) as unknown as Prisma.InputJsonValue,
      };
    },
  },
  {
    job: PORTFOLIO_SNAPSHOT_JOB,
    cadence: "daily",
    dependsOn: [PRICE_SYNC_JOB],
    async run({ runDay }) {
      const row = await prisma.jobRun.findUnique({
        where: { job_runDay: { job: PRICE_SYNC_JOB, runDay } },
        select: { detail: true },
      });
      const summary = parsePriceSyncLedgerDetail(row?.detail ?? null);
      if (!summary) {
        throw new Error(
          `${PORTFOLIO_SNAPSHOT_JOB}: missing or unreadable ${PRICE_SYNC_JOB} detail for ${runDay.toISOString().slice(0, 10)}`,
        );
      }

      const outcome = await runPortfolioSnapshotStep(summary);
      return {
        done: true,
        detail: {
          ok: outcome.allOk,
          snapshotOk: outcome.snapshotOk,
          errors: outcome.errors,
          failedTickers: outcome.failedTickers,
        },
      };
    },
  },
  {
    job: PRICE_HISTORY_JOB,
    cadence: "daily",
    dependsOn: [PRICE_SYNC_JOB],
    async run(ctx) {
      return runPriceHistorySync(ctx);
    },
  },
];
