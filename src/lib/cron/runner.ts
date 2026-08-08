import { waitUntil } from "@vercel/functions";
import { Prisma } from "@/generated/prisma/client";
import type { JobStatus } from "@/generated/prisma/enums";
import { CRON_JOBS, type CronJob } from "@/lib/cron/jobs";
import { remainingBudget, shouldRunJob, utcRunDay } from "@/lib/cron/schedule";
import { prisma } from "@/lib/prisma";

/** Reserved ledger row that holds the dispatcher lease for the run day. */
const TICK_JOB = "__tick";
/** Soft wall-clock budget from route start; leaves headroom under maxDuration=300. */
const TICK_BUDGET_MS = 240_000;
/** Refuse to chain past this many self-continuations in one run day. */
const MAX_CHAIN = 5;

export type TickOptions = {
  /** Origin of the incoming request; used to self-continue. */
  origin: string;
  only?: string | null;
  force?: boolean;
  chain?: number;
};

export type TickJobOutcome = {
  job: string;
  status: JobStatus;
  ms: number;
  detail?: Prisma.JsonValue;
};

export type TickResult = {
  ok: boolean;
  runDay: string;
  ran: TickJobOutcome[];
  skipped?: "locked";
  chained?: number;
};

export async function runTick(options: TickOptions): Promise<TickResult> {
  const startedAtMs = Date.now();
  const runDay = utcRunDay(new Date());
  const runDayIso = runDay.toISOString().slice(0, 10);

  if (!(await claimTickLease(runDayIso))) {
    return { ok: true, runDay: runDayIso, ran: [], skipped: "locked" };
  }

  const chain = options.chain ?? 0;
  const ran: TickJobOutcome[] = [];
  const tickDetail: Record<string, Prisma.JsonValue> = { chain };
  let chained: number | undefined;
  let tickError: unknown;

  try {
    const jobs = options.only ? CRON_JOBS.filter((j) => j.job === options.only) : CRON_JOBS;
    const ledger = await loadLedger(runDay);
    let needsChain = false;
    let budgetExhausted = false;

    for (const job of jobs) {
      const decision = shouldRunJob(job, ledger, runDay, { force: options.force });
      if (!decision.run) {
        if (decision.reason === "deps-unmet") {
          await recordSkipped(job.job, runDay, decision.unmet ?? []);
          ledger.set(job.job, "SKIPPED");
        }
        ran.push({
          job: job.job,
          status: "SKIPPED",
          ms: 0,
          detail: decision.unmet
            ? { reason: decision.reason, unmet: decision.unmet }
            : { reason: decision.reason },
        });
        continue;
      }

      if (remainingBudget(startedAtMs, Date.now(), TICK_BUDGET_MS) <= 0) {
        budgetExhausted = true;
        needsChain = true;
        break;
      }

      const outcome = await runJob(job, runDay, startedAtMs);
      ledger.set(job.job, outcome.status);
      ran.push(outcome);
      // PENDING means the job asked to resume later; stop so its dependents wait.
      if (outcome.status === "PENDING") {
        needsChain = true;
        break;
      }
    }

    tickDetail.budgetExhausted = budgetExhausted;

    if (needsChain) {
      const secret = process.env.CRON_SECRET ?? process.env.SYNC_SECRET;
      if (chain >= MAX_CHAIN) {
        tickDetail.chainCapped = MAX_CHAIN;
      } else if (!secret) {
        tickDetail.chainSkipped = "missing CRON_SECRET/SYNC_SECRET";
      } else {
        chained = chain + 1;
      }
    }
  } catch (e) {
    tickError = e;
    tickDetail.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    tickDetail.ran = ran.map((r) => ({ job: r.job, status: r.status, ms: r.ms }));
    // Release before chaining, otherwise the follow-up tick sees the lease held.
    // Runs in finally so a mid-tick throw can't leave the day locked.
    try {
      await releaseTickLease(runDay, tickDetail);
    } catch (releaseError) {
      // Don't mask the original error; the 6-minute lease expiry is the fallback.
      if (tickError === undefined) throw releaseError;
      console.error(
        `[cron/tick] lease release failed after error: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
      );
    }
  }

  if (chained !== undefined) {
    waitUntil(chainTick(options.origin, chained, runDay, tickDetail));
  }

  return {
    ok: ran.every((r) => r.status !== "FAILED"),
    runDay: runDayIso,
    ran,
    ...(chained !== undefined ? { chained } : {}),
  };
}

async function runJob(job: CronJob, runDay: Date, startedAtMs: number): Promise<TickJobOutcome> {
  const jobStartedMs = Date.now();
  const claimed = await prisma.jobRun.upsert({
    where: { job_runDay: { job: job.job, runDay } },
    create: { job: job.job, runDay, status: "RUNNING", startedAt: new Date() },
    update: { status: "RUNNING", startedAt: new Date(), finishedAt: null, error: null },
    select: { cursor: true },
  });

  try {
    const result = await job.run({
      runDay,
      cursor: claimed.cursor ?? null,
      budget: { remainingMs: () => remainingBudget(startedAtMs, Date.now(), TICK_BUDGET_MS) },
    });
    const status: JobStatus = result.done ? "SUCCESS" : "PENDING";
    const updated = await prisma.jobRun.update({
      where: { job_runDay: { job: job.job, runDay } },
      data: {
        status,
        finishedAt: result.done ? new Date() : null,
        error: null,
        cursor: result.done ? Prisma.DbNull : (result.cursor ?? Prisma.DbNull),
        detail: result.detail ?? Prisma.DbNull,
      },
      select: { detail: true },
    });
    return { job: job.job, status, ms: Date.now() - jobStartedMs, detail: updated.detail };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.jobRun.update({
      where: { job_runDay: { job: job.job, runDay } },
      data: { status: "FAILED", finishedAt: new Date(), error: message },
    });
    return {
      job: job.job,
      status: "FAILED",
      ms: Date.now() - jobStartedMs,
      detail: { error: message },
    };
  }
}

async function loadLedger(runDay: Date): Promise<Map<string, JobStatus>> {
  const rows = await prisma.jobRun.findMany({
    where: { runDay },
    select: { job: true, status: true },
  });
  return new Map(rows.map((r) => [r.job, r.status]));
}

/**
 * Single atomic claim of the day's `__tick` row: insert it, or steal it when the
 * previous holder is done or its lease expired. No row back → someone else owns it.
 */
async function claimTickLease(runDayIso: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "JobRun" ("id", "job", "runDay", "status", "startedAt", "leaseUntil", "createdAt", "updatedAt")
    VALUES (
      'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
      ${TICK_JOB},
      ${runDayIso}::date,
      'RUNNING'::"JobStatus",
      now(),
      now() + interval '6 minutes',
      now(),
      now()
    )
    ON CONFLICT ("job", "runDay") DO UPDATE
      SET "status" = 'RUNNING'::"JobStatus",
          "startedAt" = now(),
          "finishedAt" = NULL,
          "error" = NULL,
          "leaseUntil" = now() + interval '6 minutes',
          "updatedAt" = now()
      WHERE "JobRun"."status" <> 'RUNNING'::"JobStatus" OR "JobRun"."leaseUntil" < now()
    RETURNING "id"
  `;
  return rows.length > 0;
}

async function releaseTickLease(runDay: Date, detail: Prisma.InputJsonValue): Promise<void> {
  await prisma.jobRun.update({
    where: { job_runDay: { job: TICK_JOB, runDay } },
    data: { status: "SUCCESS", finishedAt: new Date(), leaseUntil: null, detail },
  });
}

async function recordSkipped(job: string, runDay: Date, unmet: string[]): Promise<void> {
  const detail = { reason: "deps-unmet", unmet };
  // Atomic insert-or-update that never clobbers a SUCCESS row: a forced re-run
  // whose dependency fails must not erase evidence that this job already ran.
  await prisma.$executeRaw`
    INSERT INTO "JobRun" ("id", "job", "runDay", "status", "finishedAt", "detail", "createdAt", "updatedAt")
    VALUES (
      'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
      ${job},
      ${runDay.toISOString().slice(0, 10)}::date,
      'SKIPPED'::"JobStatus",
      now(),
      ${JSON.stringify(detail)}::jsonb,
      now(),
      now()
    )
    ON CONFLICT ("job", "runDay") DO UPDATE
      SET "status" = 'SKIPPED'::"JobStatus",
          "finishedAt" = now(),
          "error" = NULL,
          "detail" = EXCLUDED."detail",
          "updatedAt" = now()
      WHERE "JobRun"."status" <> 'SUCCESS'::"JobStatus"
  `;
}

async function chainTick(
  origin: string,
  chain: number,
  runDay: Date,
  tickDetail: Record<string, Prisma.JsonValue>,
): Promise<void> {
  const secret = process.env.CRON_SECRET ?? process.env.SYNC_SECRET;
  if (!secret) return;
  const chainOutcome: Record<string, Prisma.JsonValue> = { attempted: true };
  try {
    const res = await fetch(`${origin}/api/cron/tick?chain=${chain}`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    chainOutcome.status = res.status;
    if (!res.ok) {
      console.error(`[cron/tick] chain ${chain} responded ${res.status}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    chainOutcome.error = message;
    console.error(`[cron/tick] chain ${chain} failed: ${message}`);
  }
  // Persist the chain outcome so a failed self-chain is visible in the ledger,
  // not just in a log line. Must never reject: this runs inside waitUntil.
  try {
    await prisma.jobRun.update({
      where: { job_runDay: { job: TICK_JOB, runDay } },
      data: { detail: { ...tickDetail, chainOutcome } },
    });
  } catch (e) {
    console.error(
      `[cron/tick] chain ${chain} outcome persist failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
