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
import { runDecisionReturns } from "@/lib/shadow/decisionReturns";
import { runShadowEnqueue } from "@/lib/shadow/enqueue";
import { runShadowFill } from "@/lib/shadow/fill";
import { runShadowMark } from "@/lib/shadow/mark";

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
export const SHADOW_ENQUEUE_JOB = "shadow_enqueue";
export const SHADOW_FILL_JOB = "shadow_fill";
export const SHADOW_MARK_JOB = "shadow_mark";
export const DECISION_RETURNS_JOB = "decision_returns";

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
  // Paper-only shadow ledger. Order matters: fill → enqueue → mark, all downstream of
  // price_history because PriceHistory is both the session calendar and the price source.
  //
  // FILL RUNS BEFORE ENQUEUE on purpose. An order enqueued tonight can never fill tonight
  // (fillSession must be strictly after decisionSession), so nothing is lost by filling
  // first — while the reverse order made enqueue judge position state from a book that
  // was one session out of date: yesterday's BUY was still PENDING, so today's EXIT for
  // the same ticker was rejected `no_position` and the BUY then filled into a position
  // the routine had already exited.
  {
    job: SHADOW_FILL_JOB,
    cadence: "daily",
    dependsOn: [PRICE_HISTORY_JOB],
    async run(ctx) {
      return runShadowFill(ctx);
    },
  },
  {
    job: SHADOW_ENQUEUE_JOB,
    cadence: "daily",
    dependsOn: [SHADOW_FILL_JOB],
    async run(ctx) {
      return runShadowEnqueue(ctx);
    },
  },
  {
    job: SHADOW_MARK_JOB,
    cadence: "daily",
    dependsOn: [SHADOW_FILL_JOB],
    async run(ctx) {
      return runShadowMark(ctx);
    },
  },
  {
    job: DECISION_RETURNS_JOB,
    cadence: "daily",
    dependsOn: [PRICE_HISTORY_JOB],
    async run(ctx) {
      return runDecisionReturns(ctx);
    },
  },
];
