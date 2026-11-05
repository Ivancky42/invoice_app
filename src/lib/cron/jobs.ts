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
import { runBreadthClassify } from "@/lib/fitness/breadthClassify";
import { runCounterfactuals } from "@/lib/fitness/counterfactuals";
import { runFitnessSnapshot } from "@/lib/fitness/snapshot";
import { runEvolutionEvaluate } from "@/lib/evolution/evaluate";
import { runRuleScoring } from "@/lib/evolution/scoring";
import { runDueRecurringInvoices } from "@/lib/invoicing/recurring";
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
  everyTick?: boolean;
  run(ctx: JobContext): Promise<JobResult>;
};

export const RECURRING_INVOICES_JOB = "recurring_invoices";
export const PRICE_SYNC_JOB = "price_sync";
export const PORTFOLIO_SNAPSHOT_JOB = "portfolio_snapshot";
export const PRICE_HISTORY_JOB = "price_history";
export const BREADTH_CLASSIFY_JOB = "breadth_classify";
export const SHADOW_ENQUEUE_JOB = "shadow_enqueue";
export const SHADOW_FILL_JOB = "shadow_fill";
export const SHADOW_MARK_JOB = "shadow_mark";
export const DECISION_RETURNS_JOB = "decision_returns";
export const COUNTERFACTUAL_RESOLVE_JOB = "counterfactual_resolve";
export const FITNESS_SNAPSHOT_JOB = "fitness_snapshot";
export const EVOLUTION_EVALUATE_JOB = "evolution_evaluate";
export const RULE_SCORING_JOB = "rule_scoring";

/**
 * Ordered cron registry. Later commits append jobs here; order is the run
 * order, `dependsOn` is the hard gate.
 */
export const CRON_JOBS: CronJob[] = [
  // Billing runs first and depends on nothing, so a stock-data outage or a long shadow
  // tick can never delay an invoice. The tick fires 22:00 UTC = 06:00 Asia/Kuala_Lumpur,
  // and "today" is judged in BILLING_TIMEZONE, so a schedule dated the 5th bills at
  // ~06:00 on the 5th. Idempotent: a re-run or a forced tick never bills a date twice.
  {
    job: RECURRING_INVOICES_JOB,
    cadence: "daily",
    dependsOn: [],
    // The ledger keys runs by UTC day but billing is by MYT day; a no-op re-run at 09:00 MYT
    // (01:00 UTC) must not mark the next 06:00 MYT tick as already done.
    everyTick: true,
    async run() {
      const result = await runDueRecurringInvoices();
      const detail = {
        today: result.today,
        schedulesDue: result.schedulesDue,
        generated: result.generated.map((g) => ({ schedule: g.scheduleName, number: g.number, runDate: g.runDate })),
        ended: result.ended,
        errors: result.errors,
        emails: {
          sent: result.emails.sent.map((e) => e.number),
          failed: result.emails.failed,
          dropped: result.emails.dropped,
        },
      };
      if (result.errors.length > 0) {
        // Other schedules already billed; FAILED surfaces the error in the ledger.
        throw new Error(
          `recurring_invoices: ${result.errors.length} schedule(s) failed — ${result.errors
            .map((e) => `${e.name}: ${e.error}`)
            .join("; ")
            .slice(0, 800)}`,
        );
      }
      return { done: true, detail: detail as unknown as Prisma.InputJsonValue };
    },
  },
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
  // Attributes each recent decision's ticker move to the market / theme / the name
  // itself. Depends only on price_history (the bars); does not touch the shadow ledger.
  {
    job: BREADTH_CLASSIFY_JOB,
    cadence: "daily",
    dependsOn: [PRICE_HISTORY_JOB],
    async run(ctx) {
      return runBreadthClassify(ctx);
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
  // Seeding needs today's closes (price_history) and the marked book (shadow_mark) for
  // the DNAD / double-count weights; resolution needs the same closes.
  {
    job: COUNTERFACTUAL_RESOLVE_JOB,
    cadence: "daily",
    dependsOn: [PRICE_HISTORY_JOB, SHADOW_MARK_JOB],
    async run(ctx) {
      return runCounterfactuals(ctx);
    },
  },
  // Last: the snapshot scores the marked book AND the credits this tick just resolved.
  {
    job: FITNESS_SNAPSHOT_JOB,
    cadence: "daily",
    dependsOn: [SHADOW_MARK_JOB, COUNTERFACTUAL_RESOLVE_JOB],
    async run(ctx) {
      return runFitnessSnapshot(ctx);
    },
  },
  // Judges the challenger on the snapshot this tick just wrote, and is the ONLY code path
  // that can promote a ruleset. Deliberately not exposed as an agent tool (see the
  // registration comment in src/lib/agent/mcp-tools.ts, mirroring the patch_config
  // precedent): the proposer must never be able to crown its own proposal.
  {
    job: EVOLUTION_EVALUATE_JOB,
    cadence: "daily",
    dependsOn: [FITNESS_SNAPSHOT_JOB],
    async run(ctx) {
      return runEvolutionEvaluate(ctx);
    },
  },
  // Monthly retrospective: HELPED / NEUTRAL / HURT on versions whose data has settled.
  // Independent of today's snapshot — it only reads long-closed windows.
  {
    job: RULE_SCORING_JOB,
    cadence: "monthly",
    dependsOn: [],
    async run(ctx) {
      return runRuleScoring(ctx);
    },
  },
];
