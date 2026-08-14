import type { JobStatus } from "@/generated/prisma/enums";

export type Cadence = "daily" | "monthly";

/** Registry shape needed to decide whether a job runs — no run function, no prisma. */
export type JobDescriptor = {
  job: string;
  cadence: Cadence;
  dependsOn: string[];
};

export type SkipReason = "already-success" | "not-due" | "deps-unmet";

export type JobDecision =
  | { run: true }
  | { run: false; reason: SkipReason; unmet?: string[] };

/** UTC calendar date of `date`, normalized to midnight UTC (matches `@db.Date`). */
export function utcRunDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Monthly jobs only fire on the 1st (UTC). */
export function isMonthlyDue(runDay: Date): boolean {
  return runDay.getUTCDate() === 1;
}

/** Daily jobs are stale once the last SUCCESS is older than this many UTC days. */
export const DAILY_STALE_JOB_DAYS = 2;
/** Monthly jobs are stale once the last SUCCESS is older than this many UTC days. */
export const MONTHLY_STALE_JOB_DAYS = 35;

/**
 * Whether a registered cron job should appear in `lastRun.staleJobs`.
 * Monthly jobs that have never succeeded are expected until their first 1st;
 * after that, a missed 1st (or a success older than {@link MONTHLY_STALE_JOB_DAYS})
 * is stale. Daily jobs with no success are always stale.
 */
export function isJobStale(
  cadence: Cadence,
  lastSuccess: Date | null,
  todayUtc: Date,
): boolean {
  if (!lastSuccess) {
    return cadence === "monthly" ? isMonthlyDue(utcRunDay(todayUtc)) : true;
  }
  const todayMs = Date.UTC(
    todayUtc.getUTCFullYear(),
    todayUtc.getUTCMonth(),
    todayUtc.getUTCDate(),
  );
  const lastMs = Date.UTC(
    lastSuccess.getUTCFullYear(),
    lastSuccess.getUTCMonth(),
    lastSuccess.getUTCDate(),
  );
  const daysBehind = Math.round((todayMs - lastMs) / 86_400_000);
  const threshold = cadence === "monthly" ? MONTHLY_STALE_JOB_DAYS : DAILY_STALE_JOB_DAYS;
  return daysBehind > threshold;
}

/**
 * Decide whether a job should run for `runDay` given the ledger for that day.
 * `force` re-runs jobs that already succeeded but still honours dependencies.
 */
export function shouldRunJob(
  descriptor: JobDescriptor,
  ledger: Map<string, JobStatus>,
  runDay: Date,
  options: { force?: boolean } = {},
): JobDecision {
  if (descriptor.cadence === "monthly" && !isMonthlyDue(runDay)) {
    return { run: false, reason: "not-due" };
  }

  if (!options.force && ledger.get(descriptor.job) === "SUCCESS") {
    return { run: false, reason: "already-success" };
  }

  const unmet = descriptor.dependsOn.filter((dep) => ledger.get(dep) !== "SUCCESS");
  if (unmet.length > 0) return { run: false, reason: "deps-unmet", unmet };

  return { run: true };
}

/** Milliseconds left in the tick's soft budget; never negative. */
export function remainingBudget(startedAtMs: number, nowMs: number, budgetMs: number): number {
  return Math.max(0, budgetMs - (nowMs - startedAtMs));
}
