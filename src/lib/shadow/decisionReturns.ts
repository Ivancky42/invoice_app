/**
 * `decision_returns`: fill DecisionReview 1w / 4w / 3m returns from PriceHistory.
 *
 * Horizons are counted in SESSIONS, not calendar days, so holidays cannot shorten or
 * stretch a window. A horizon whose session does not exist yet (or whose ticker has no
 * bar) is left null — a partially-covered row is filled for the horizons it can support.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import { prisma } from "@/lib/prisma";
import {
  decisionSessionFromEasternDate,
  easternDateOf,
  loadSessions,
  sessionDate,
  sessionOffsetIn,
  ymd,
} from "@/lib/shadow/sessions";
import { decToNum } from "@/lib/stocks/format";

/** Sessions after the decision session for each review horizon. */
export const HORIZON_SESSIONS = { return1wPct: 5, return4wPct: 20, return3mPct: 63 } as const;

type HorizonField = keyof typeof HORIZON_SESSIONS;

/** Rows older than this can no longer gain coverage worth re-scanning for. */
const LOOKBACK_DAYS = 400;

/** Rows examined per run. */
const MAX_ROWS = 500;

export type DecisionReturnsDetail = {
  scanned: number;
  updated: number;
  fieldsWritten: number;
};

/**
 * Fraction → percentage points.
 *
 * THE one fraction→pp conversion site in the codebase: PriceHistory maths is done in
 * fractions, while `return1wPct` / `return4wPct` / `return3mPct` are percentage-point
 * columns (−2.5 means −2.5%). Every other module keeps fractions end to end.
 */
export function toPercentagePoints(fraction: number): number {
  return Math.round(fraction * 100 * 1e4) / 1e4;
}

export async function fillDecisionReturns(ctx: {
  runDay: Date;
}): Promise<DecisionReturnsDetail> {
  const sessions = await loadSessions();
  const since = new Date(ctx.runDay.getTime() - LOOKBACK_DAYS * 86_400_000);

  // Tickers PriceHistory can actually price in the window (a small set — the nightly
  // universe). Rows for anything else can never be filled, so they are kept OUT of the
  // batch entirely: inside it they would occupy the same 500 oldest slots every run and
  // starve fillable rows until those aged out of the window unnoticed.
  const covered = await prisma.priceHistory.groupBy({
    by: ["ticker"],
    where: { date: { gte: since } },
  });
  // DecisionReview.ticker is uppercased by the agent write path but not by the Notion
  // sync, so both cases are allowed through the `in` filter.
  const coveredTickers = [
    ...new Set(covered.flatMap((r) => [r.ticker.toUpperCase(), r.ticker.toLowerCase()])),
  ];
  if (coveredTickers.length === 0) {
    return { scanned: 0, updated: 0, fieldsWritten: 0 };
  }

  const rows = await prisma.decisionReview.findMany({
    where: {
      ticker: { in: coveredTickers },
      createdAt: { gte: since },
      OR: [
        { return1wPct: null },
        { return4wPct: null },
        { return3mPct: null },
      ],
    },
    select: {
      id: true,
      ticker: true,
      createdAt: true,
      return1wPct: true,
      return4wPct: true,
      return3mPct: true,
    },
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS,
  });

  const detail: DecisionReturnsDetail = { scanned: rows.length, updated: 0, fieldsWritten: 0 };
  if (rows.length === 0) return detail;

  // Work out every (ticker, session) close needed, then fetch them in one query.
  type Plan = { id: string; ticker: string; base: string; horizons: Array<[HorizonField, string]> };
  const plans: Plan[] = [];
  const wantedDays = new Set<string>();
  const wantedTickers = new Set<string>();

  for (const row of rows) {
    const ticker = row.ticker!.trim().toUpperCase();
    const base = decisionSessionFromEasternDate(sessions, easternDateOf(row.createdAt));
    if (!base) continue;

    const horizons: Array<[HorizonField, string]> = [];
    for (const field of Object.keys(HORIZON_SESSIONS) as HorizonField[]) {
      if (row[field] !== null) continue; // never overwrite an existing value
      const day = sessionOffsetIn(sessions, base, HORIZON_SESSIONS[field]);
      if (!day) continue; // horizon has not elapsed yet
      horizons.push([field, day]);
      wantedDays.add(day);
    }
    if (horizons.length === 0) continue;

    plans.push({ id: row.id, ticker, base, horizons });
    wantedDays.add(base);
    wantedTickers.add(ticker);
  }

  if (plans.length === 0) return detail;

  const bars = await prisma.priceHistory.findMany({
    where: {
      ticker: { in: [...wantedTickers] },
      date: { in: [...wantedDays].map(sessionDate) },
    },
    select: { ticker: true, date: true, close: true },
  });
  const closeByKey = new Map(bars.map((b) => [`${b.ticker}|${ymd(b.date)}`, decToNum(b.close)]));

  for (const plan of plans) {
    const baseClose = closeByKey.get(`${plan.ticker}|${plan.base}`) ?? null;
    if (baseClose === null || baseClose <= 0) continue; // no coverage — leave null

    const data: Prisma.DecisionReviewUpdateInput = {};
    for (const [field, day] of plan.horizons) {
      const close = closeByKey.get(`${plan.ticker}|${day}`) ?? null;
      if (close === null || close <= 0) continue;
      data[field] = toPercentagePoints(close / baseClose - 1);
      detail.fieldsWritten += 1;
    }
    if (Object.keys(data).length === 0) continue;

    await prisma.decisionReview.update({ where: { id: plan.id }, data });
    detail.updated += 1;
  }

  return detail;
}

export async function runDecisionReturns(ctx: JobContext): Promise<JobResult> {
  const detail = await fillDecisionReturns({ runDay: ctx.runDay });
  return { done: true, detail: detail as unknown as Prisma.InputJsonValue };
}
