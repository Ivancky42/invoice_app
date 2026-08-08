import { describe, expect, it } from "vitest";
import type { JobStatus } from "@/generated/prisma/enums";
import {
  isMonthlyDue,
  remainingBudget,
  shouldRunJob,
  utcRunDay,
  type JobDescriptor,
} from "@/lib/cron/schedule";

const daily = (job: string, dependsOn: string[] = []): JobDescriptor => ({
  job,
  cadence: "daily",
  dependsOn,
});

const ledgerOf = (entries: Record<string, JobStatus>) =>
  new Map<string, JobStatus>(Object.entries(entries));

const DAY = new Date(Date.UTC(2026, 7, 8));
const FIRST = new Date(Date.UTC(2026, 8, 1));

describe("utcRunDay", () => {
  it("normalizes to midnight UTC of the instant's UTC date", () => {
    expect(utcRunDay(new Date("2026-08-08T22:00:00.000Z")).toISOString()).toBe(
      "2026-08-08T00:00:00.000Z",
    );
  });

  it("is stable regardless of the local timezone offset of the input", () => {
    // Same instant expressed in GMT+8 and GMT-5 → same UTC run day.
    const a = utcRunDay(new Date("2026-08-09T06:00:00.000+08:00"));
    const b = utcRunDay(new Date("2026-08-08T17:00:00.000-05:00"));
    expect(a.toISOString()).toBe("2026-08-08T00:00:00.000Z");
    expect(b.toISOString()).toBe(a.toISOString());
  });

  it("rolls to the next UTC day past midnight UTC", () => {
    expect(utcRunDay(new Date("2026-08-09T00:00:01.000Z")).toISOString()).toBe(
      "2026-08-09T00:00:00.000Z",
    );
  });
});

describe("isMonthlyDue", () => {
  it("is true only on the 1st (UTC)", () => {
    expect(isMonthlyDue(FIRST)).toBe(true);
    expect(isMonthlyDue(DAY)).toBe(false);
  });
});

describe("shouldRunJob", () => {
  it("runs a job with no dependencies and no ledger row", () => {
    expect(shouldRunJob(daily("price_sync"), ledgerOf({}), DAY)).toEqual({ run: true });
  });

  it("runs when every dependency succeeded", () => {
    const decision = shouldRunJob(
      daily("portfolio_snapshot", ["price_sync"]),
      ledgerOf({ price_sync: "SUCCESS" }),
      DAY,
    );
    expect(decision).toEqual({ run: true });
  });

  it("skips when a dependency FAILED", () => {
    expect(
      shouldRunJob(
        daily("portfolio_snapshot", ["price_sync"]),
        ledgerOf({ price_sync: "FAILED" }),
        DAY,
      ),
    ).toEqual({ run: false, reason: "deps-unmet", unmet: ["price_sync"] });
  });

  it("skips when a dependency has no row at all", () => {
    expect(
      shouldRunJob(daily("portfolio_snapshot", ["price_sync"]), ledgerOf({}), DAY),
    ).toEqual({ run: false, reason: "deps-unmet", unmet: ["price_sync"] });
  });

  it("names every unmet dependency", () => {
    const decision = shouldRunJob(
      daily("c", ["a", "b"]),
      ledgerOf({ a: "SUCCESS", b: "PENDING" }),
      DAY,
    );
    expect(decision).toEqual({ run: false, reason: "deps-unmet", unmet: ["b"] });
  });

  it("skips a job that already succeeded today", () => {
    expect(shouldRunJob(daily("price_sync"), ledgerOf({ price_sync: "SUCCESS" }), DAY)).toEqual({
      run: false,
      reason: "already-success",
    });
  });

  it("re-runs a succeeded job when forced", () => {
    expect(
      shouldRunJob(daily("price_sync"), ledgerOf({ price_sync: "SUCCESS" }), DAY, { force: true }),
    ).toEqual({ run: true });
  });

  it("still gates dependencies when forced", () => {
    expect(
      shouldRunJob(
        daily("portfolio_snapshot", ["price_sync"]),
        ledgerOf({ portfolio_snapshot: "SUCCESS" }),
        DAY,
        { force: true },
      ),
    ).toEqual({ run: false, reason: "deps-unmet", unmet: ["price_sync"] });
  });

  it("retries a job that FAILED earlier today without force", () => {
    expect(shouldRunJob(daily("price_sync"), ledgerOf({ price_sync: "FAILED" }), DAY)).toEqual({
      run: true,
    });
  });

  it("holds monthly jobs until the 1st", () => {
    const monthly: JobDescriptor = { job: "monthly_report", cadence: "monthly", dependsOn: [] };
    expect(shouldRunJob(monthly, ledgerOf({}), DAY)).toEqual({ run: false, reason: "not-due" });
    expect(shouldRunJob(monthly, ledgerOf({}), FIRST)).toEqual({ run: true });
  });

  it("keeps monthly jobs off-days even when forced", () => {
    const monthly: JobDescriptor = { job: "monthly_report", cadence: "monthly", dependsOn: [] };
    expect(shouldRunJob(monthly, ledgerOf({}), DAY, { force: true })).toEqual({
      run: false,
      reason: "not-due",
    });
  });
});

describe("remainingBudget", () => {
  it("returns the untouched budget at t0", () => {
    expect(remainingBudget(1_000, 1_000, 240_000)).toBe(240_000);
  });

  it("subtracts elapsed time", () => {
    expect(remainingBudget(1_000, 61_000, 240_000)).toBe(180_000);
  });

  it("clamps at zero once the budget is blown", () => {
    expect(remainingBudget(1_000, 500_000, 240_000)).toBe(0);
  });
});
