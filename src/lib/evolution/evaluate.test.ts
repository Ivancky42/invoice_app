import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import {
  bucketCreditsBySnapshot,
  pairFitnessIncrements,
  pairingIncrementOf,
  type PairableSnapshot,
} from "@/lib/evolution/evaluate";
import { sequentialZ } from "@/lib/fitness/math";

const dec = (n: number) => n as unknown as Prisma.Decimal;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`).getTime();

describe("bucketCreditsBySnapshot", () => {
  const sessions = [day("2026-09-21"), day("2026-09-25"), day("2026-09-28")];

  it("charges a horizon to the first snapshot on or after it, like fitness_snapshot's span", () => {
    const out = bucketCreditsBySnapshot(sessions, [
      { horizonMs: day("2026-09-22"), credit: -0.01 }, // gap day → 09-25's span
      { horizonMs: day("2026-09-25"), credit: -0.02 }, // exact session
      { horizonMs: day("2026-09-28"), credit: 0.005 },
    ]);
    expect(out.get(day("2026-09-25"))).toBeCloseTo(-0.03, 10);
    expect(out.get(day("2026-09-28"))).toBeCloseTo(0.005, 10);
    expect(out.has(day("2026-09-21"))).toBe(false);
  });

  it("drops horizons past the last snapshot (not charged yet)", () => {
    const out = bucketCreditsBySnapshot(sessions, [
      { horizonMs: day("2026-09-29"), credit: -0.5 },
    ]);
    expect(out.size).toBe(0);
  });
});

describe("pairingIncrementOf credit override", () => {
  it("replaces the stored avoidedCreditDelta when a credit is passed", () => {
    const row = {
      dailyIncrement: dec(0.001),
      avoidedCreditDelta: dec(-0.045),
      turnoverDelta: dec(0),
    };
    expect(pairingIncrementOf(row)).toBeCloseTo(-0.044, 10);
    expect(pairingIncrementOf(row, 0)).toBeCloseTo(0.001, 10);
    expect(pairingIncrementOf(row, 0.004)).toBeCloseTo(0.005, 10);
  });
});

describe("in-trial credit only (v8 regression)", () => {
  // Identical NAV paths; only LIVE carries credits from refusals made before the clone.
  const increments = [0.002, -0.003, 0.005, -0.004, 0.001, 0.006, -0.002, 0.003, -0.001, 0.004];
  const liveCredits = [0, -0.03, 0, -0.008, -0.046, 0, -0.034, 0.02, -0.05, 0];

  function series(inTrialOnly: boolean) {
    const cand = new Map<number, PairableSnapshot>();
    const live = new Map<number, PairableSnapshot>();
    increments.forEach((inc, i) => {
      cand.set(i, { fitnessIncrement: inc, maxDrawdown: 0, nav: 100_000 });
      const credit = liveCredits[i];
      live.set(i, {
        fitnessIncrement: pairingIncrementOf(
          { dailyIncrement: dec(inc), avoidedCreditDelta: dec(credit), turnoverDelta: dec(0) },
          inTrialOnly ? 0 : undefined,
        ),
        maxDrawdown: 0,
        nav: 100_000,
      });
    });
    return sequentialZ(pairFitnessIncrements(cand, live).dailyDeltas);
  }

  it("without the exclusion, the asymmetry alone reads as a positive edge", () => {
    expect(series(false).delta).toBeGreaterThan(0.01);
  });

  it("with it, identical books pair to zero and the test cannot fire", () => {
    const { delta, z } = series(true);
    expect(delta).toBeCloseTo(0, 10);
    expect(z).toBeNull();
  });
});
