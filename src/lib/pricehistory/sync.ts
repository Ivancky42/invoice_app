import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { CSPX_EODHD_SYMBOL } from "@/lib/eodhd/quote";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import { isFinnhubRateLimit } from "@/lib/finnhub/quote";
import { fetchEodhdHistory, isEodhdQuotaError } from "@/lib/pricehistory/providers/eodhd";
import { fetchFinnhubDailyBar, easternSessionDate } from "@/lib/pricehistory/providers/finnhub";
import { fetchStooqHistory } from "@/lib/pricehistory/providers/stooq";
import {
  CALENDAR_ANCHOR_TICKERS,
  collectPriceHistoryUniverse,
  CSPX_TICKER,
  eodhdUsSymbol,
} from "@/lib/pricehistory/symbols";
import type { DailyBar } from "@/lib/pricehistory/types";
import { prisma } from "@/lib/prisma";

/** Leave this much headroom in the tick budget before yielding a cursor. */
const BUDGET_HEADROOM_MS = 20_000;

/** Widen the CSPX EODHD lookup to survive weekends/holidays on the LSE calendar. */
const CSPX_LOOKBACK_DAYS = 7;

/**
 * When Finnhub misses (rate-limit after price_sync, empty quote, bot-blocked
 * stooq "today" fetch), pull this many calendar days of EOD history and write
 * every bar. One fallback call heals a multi-day gap instead of leaving it.
 */
export const FALLBACK_LOOKBACK_DAYS = 7;

/**
 * Finnhub's free tier allows 60 calls/minute. 1.1s keeps this job under it — the old
 * 220ms (~270/min) tripped a 429 within seconds, after which Finnhub was switched off
 * for the whole run and every ticker fell through to EODHD's 20-calls/day free quota.
 */
const MS_BETWEEN_FINNHUB = 1_100;

/**
 * price_sync runs just before this job on the same key (paced the same way, but its last
 * minute can still be near the quota). On the first 429, wait out the window once
 * instead of giving up.
 */
const FINNHUB_COOLDOWN_MS = 61_000;

const MS_BETWEEN_EODHD = 220;

/**
 * EODHD's free tier is 20 calls/day, and price_sync's CSPX quote spends one. CSPX history
 * goes first; the rest heals gaps. Leaves a few calls spare for manual backfills.
 */
export const EODHD_CALLS_PER_RUN = 15;

/** Longest gap one EODHD history call is asked to heal (calendar days). */
export const GAP_HEAL_MAX_DAYS = 45;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type PriceHistorySyncDetail = {
  updated: number;
  failed: number;
  failedTickers: string[];
  /** EODHD calls spent this run (free tier: 20/day, see EODHD_CALLS_PER_RUN). */
  eodhdCalls?: number;
};

/**
 * Ticker-keyed resume cursor: `after` is the last fully-processed ticker ("" =
 * none yet). A positional index would silently skip a ticker whenever a
 * Portfolio/Watchlist change mid-chain shifts the recomputed universe; keying
 * by symbol pins the resume point regardless of membership churn. Counters
 * ride along so the final SUCCESS detail reports day totals, not just the
 * last chunk's.
 */
const cursorSchema = z.object({
  after: z.string(),
  updated: z.number().int().min(0),
  failed: z.number().int().min(0),
  failedTickers: z.array(z.string()),
  /** Carried across chained ticks so a 429 keeps Finnhub off for the rest of the day. */
  finnhubDisabled: z.boolean().optional(),
  /** Carried across chained ticks so a 402 keeps EODHD off for the rest of the day. */
  eodhdDisabled: z.boolean().optional(),
  /** EODHD calls spent so far today (see {@link EODHD_CALLS_PER_RUN}). */
  eodhdCalls: z.number().int().min(0).optional(),
});

type PriceHistorySyncCursor = z.infer<typeof cursorSchema>;

const EMPTY_CURSOR: PriceHistorySyncCursor = { after: "", updated: 0, failed: 0, failedTickers: [] };

function parseCursor(cursor: Prisma.JsonValue | null): PriceHistorySyncCursor {
  if (cursor === null) return EMPTY_CURSOR;
  const parsed = cursorSchema.safeParse(cursor);
  return parsed.success ? parsed.data : EMPTY_CURSOR;
}

/**
 * First index in the ordered universe after `after` ("" = start).
 * `ordered` must be {@link orderPriceHistoryUniverse} output (anchors, then
 * optional paper priority, then A–Z). A vanished `after` resumes at the next
 * remaining member of that band; a ticker inserted earlier in the order is
 * picked up next daily run.
 */
const ANCHOR_SET = new Set<string>(CALENDAR_ANCHOR_TICKERS);

export function resumeIndex(
  ordered: string[],
  after: string,
  priority: Iterable<string> = [],
): number {
  if (after === "") return 0;
  const idx = ordered.indexOf(after);
  if (idx !== -1) return idx + 1;

  const prioSet = new Set(
    [...priority]
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t && !ANCHOR_SET.has(t)),
  );

  const isAnchor = ANCHOR_SET.has(after);
  const isPrio = prioSet.has(after);

  if (isAnchor) {
    const nextAnchor = ordered.find((t) => ANCHOR_SET.has(t) && t > after);
    if (nextAnchor) return ordered.indexOf(nextAnchor);
    const restStart = ordered.findIndex((t) => !ANCHOR_SET.has(t));
    return restStart === -1 ? ordered.length : restStart;
  }

  if (isPrio) {
    const nextPrio = ordered.find((t) => prioSet.has(t) && t > after);
    if (nextPrio) return ordered.indexOf(nextPrio);
    const restStart = ordered.findIndex((t) => !ANCHOR_SET.has(t) && !prioSet.has(t));
    return restStart === -1 ? ordered.length : restStart;
  }

  const restStart = ordered.findIndex((t) => !ANCHOR_SET.has(t) && !prioSet.has(t));
  if (restStart === -1) return ordered.length;
  const j = ordered.findIndex((t, i) => i >= restStart && t > after);
  return j === -1 ? ordered.length : j;
}

function toDateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Inclusive `[from, to]` window ending on `toYmd` (YYYY-MM-DD). */
export function lookbackWindow(
  toYmd: string,
  days = FALLBACK_LOOKBACK_DAYS,
): { from: string; to: string } {
  const to = new Date(`${toYmd}T00:00:00.000Z`);
  if (Number.isNaN(to.getTime())) throw new Error(`invalid lookback to-date: ${toYmd}`);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString().slice(0, 10), to: toYmd };
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Start of the EODHD window that heals a ticker's gap in one call: the day after its last
 * stored bar, but never less than the standard lookback and never more than
 * {@link GAP_HEAL_MAX_DAYS}. A ticker with no history gets the maximum.
 */
export function healWindowFrom(lastBarYmd: string | null, todaySession: string): string {
  const floor = lookbackWindow(todaySession, GAP_HEAL_MAX_DAYS).from;
  if (lastBarYmd === null) return floor;
  const standard = lookbackWindow(todaySession).from;
  const dayAfter = addDaysYmd(lastBarYmd, 1);
  const from = dayAfter < standard ? dayAfter : standard;
  return from < floor ? floor : from;
}

/** True when a ticker is missing at least the previous session's bar. */
export function hasGap(lastBarYmd: string | null, previousSession: string | null): boolean {
  if (previousSession === null) return false;
  return lastBarYmd === null || lastBarYmd < previousSession;
}

/** Finnhub `/quote` is only "today's bar" when its own session date matches. */
export function isCurrentSessionBar(bar: DailyBar, todaySession: string): boolean {
  return bar.date === todaySession;
}

export function sortBarsByDate(bars: DailyBar[]): DailyBar[] {
  return [...bars].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Prefer both reasons so a Finnhub miss does not hide an EODHD/stooq failure. */
export function syncFailureMessage(
  finnhubError: string | null,
  fallbackError: string | null,
): string {
  return [finnhubError, fallbackError].filter((s): s is string => Boolean(s)).join("; ") || "unknown error";
}

/**
 * EODHD first (same key the CSPX path already uses), then stooq. Returns the
 * full lookback so a Finnhub miss can close several missing sessions at once.
 */
export async function fetchFallbackBars(
  ticker: string,
  todaySession: string,
  eodhdKey: string | undefined,
  opts: { eodhdDisabled?: boolean; eodhdSkipReason?: string; from?: string } = {},
): Promise<{
  bars: DailyBar[];
  error: string | null;
  eodhdQuota: boolean;
  eodhdCalled: boolean;
}> {
  const { to } = lookbackWindow(todaySession);
  const from = opts.from ?? lookbackWindow(todaySession).from;
  const errors: string[] = [];
  let eodhdQuota = false;
  let eodhdCalled = false;

  if (opts.eodhdDisabled) {
    errors.push(opts.eodhdSkipReason ?? "EODHD skipped (quota earlier this run)");
  } else if (eodhdKey) {
    try {
      await sleep(MS_BETWEEN_EODHD);
      eodhdCalled = true;
      const bars = sortBarsByDate(
        await fetchEodhdHistory(ticker, eodhdUsSymbol(ticker), from, to, eodhdKey),
      );
      if (bars.length > 0) return { bars, error: null, eodhdQuota: false, eodhdCalled };
      errors.push("eodhd: no rows");
    } catch (e) {
      if (isEodhdQuotaError(e)) eodhdQuota = true;
      errors.push(e instanceof Error ? e.message : String(e));
    }
  } else {
    errors.push("EODHD_API_KEY is not set");
  }

  try {
    const bars = sortBarsByDate(await fetchStooqHistory(ticker, from, to));
    if (bars.length > 0) return { bars, error: null, eodhdQuota, eodhdCalled };
    errors.push("stooq: no rows");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  return { bars: [], error: errors.join("; "), eodhdQuota, eodhdCalled };
}

function toBigIntOrNull(volume: number | undefined): bigint | null {
  if (volume === undefined || !Number.isFinite(volume)) return null;
  return BigInt(Math.round(volume));
}

/**
 * Update payload for an already-stored bar. A re-stamp must not degrade a
 * richer row: a sparse bar (e.g. Finnhub /quote landing on a session already
 * backfilled by eodhd with adjClose + volume) leaves those columns untouched
 * (`undefined` in Prisma = "do not update") instead of nulling them out.
 * `close` and `source` always update.
 */
export function mergeBarUpdate(bar: DailyBar): {
  open?: number;
  close: number;
  adjClose?: number;
  volume?: bigint;
  source: string;
} {
  const volume = toBigIntOrNull(bar.volume);
  return {
    open: bar.open ?? undefined,
    close: bar.close,
    adjClose: bar.adjClose ?? undefined,
    volume: volume ?? undefined,
    source: bar.source,
  };
}

async function upsertBar(bar: DailyBar): Promise<void> {
  const date = toDateOnly(bar.date);
  await prisma.priceHistory.upsert({
    where: { ticker_date: { ticker: bar.ticker, date } },
    create: {
      ticker: bar.ticker,
      date,
      open: bar.open ?? null,
      close: bar.close,
      adjClose: bar.adjClose ?? null,
      volume: toBigIntOrNull(bar.volume),
      source: bar.source,
    },
    update: mergeBarUpdate(bar),
  });
}

async function recordStatusSuccess(ticker: string, source: string): Promise<void> {
  const now = new Date();
  await prisma.tickerPriceStatus.upsert({
    where: { ticker },
    create: {
      ticker,
      lastSuccessAt: now,
      lastAttemptAt: now,
      lastSource: source,
      lastError: null,
      consecutiveFailures: 0,
    },
    update: {
      lastSuccessAt: now,
      lastAttemptAt: now,
      lastSource: source,
      lastError: null,
      consecutiveFailures: 0,
    },
  });
}

async function recordStatusFailure(ticker: string, error: string): Promise<void> {
  const now = new Date();
  await prisma.tickerPriceStatus.upsert({
    where: { ticker },
    create: {
      ticker,
      lastAttemptAt: now,
      lastError: error,
      consecutiveFailures: 1,
    },
    update: {
      lastAttemptAt: now,
      lastError: error,
      consecutiveFailures: { increment: 1 },
    },
  });
}

/** CSPX.LSE bars from `fromYmd` (or the standard LSE-safe lookback) through today. */
async function fetchCspxBars(eodhdKey: string | undefined, fromYmd?: string): Promise<DailyBar[]> {
  if (!eodhdKey) throw new Error("EODHD_API_KEY is not set");
  const to = new Date();
  const lookbackFrom = new Date(to.getTime() - CSPX_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const from = fromYmd && fromYmd < lookbackFrom ? fromYmd : lookbackFrom;
  const bars = await fetchEodhdHistory(
    CSPX_TICKER,
    CSPX_EODHD_SYMBOL,
    from,
    to.toISOString().slice(0, 10),
    eodhdKey,
  );
  return sortBarsByDate(bars);
}

/** Latest stored bar per ticker, and the last anchor session before today. */
async function loadGapState(
  universe: string[],
  todaySession: string,
): Promise<{ lastBar: Map<string, string>; previousSession: string | null }> {
  const [rows, prev] = await Promise.all([
    prisma.priceHistory.groupBy({
      by: ["ticker"],
      where: { ticker: { in: universe } },
      _max: { date: true },
    }),
    prisma.priceHistory.findFirst({
      where: { ticker: { in: [...CALENDAR_ANCHOR_TICKERS] }, date: { lt: toDateOnly(todaySession) } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);
  const lastBar = new Map<string, string>();
  for (const r of rows) {
    if (r._max.date) lastBar.set(r.ticker, r._max.date.toISOString().slice(0, 10));
  }
  return { lastBar, previousSession: prev ? prev.date.toISOString().slice(0, 10) : null };
}

/**
 * Nightly price-history sync: one bar per universe ticker for today's session.
 *
 * Built for the free tiers: Finnhub (60/min) serves today's bar for US names, paced to
 * stay under the limit, with one cooldown if price_sync left the minute spent. EODHD
 * (20/day) is rationed per run: CSPX first (it has no other source), then gap healing —
 * one history call per ticker, from its last stored bar, for Finnhub misses and for
 * tickers Finnhub served but that are missing earlier sessions. stooq is the last resort.
 * Idempotent upserts, resumable via `cursor` when the tick budget runs low.
 */
export async function runPriceHistorySync(ctx: JobContext): Promise<JobResult> {
  const { ordered: universe, priority } = await collectPriceHistoryUniverse();
  const resume = parseCursor(ctx.cursor);
  const startIndex = resumeIndex(universe, resume.after, priority);

  const finnhubKey = process.env.FINNHUB_API_KEY?.trim();
  const eodhdKey = process.env.EODHD_API_KEY?.trim();

  let updated = resume.updated;
  let failed = resume.failed;
  const failedTickers: string[] = [...resume.failedTickers];
  let lastProcessed = resume.after;
  const todaySession = easternSessionDate(Math.floor(Date.now() / 1000));
  let finnhubDisabled = resume.finnhubDisabled === true || !finnhubKey;
  let finnhubCooledDown = false;
  // A 402 is the daily/plan cap, not a per-ticker miss.
  let eodhdDisabled = resume.eodhdDisabled === true;
  let eodhdCalls = resume.eodhdCalls ?? 0;
  const eodhdAvailable = () => !eodhdDisabled && eodhdCalls < EODHD_CALLS_PER_RUN;
  const eodhdSkipReason = () =>
    eodhdDisabled
      ? "EODHD skipped (quota earlier this run)"
      : `EODHD skipped (per-run budget of ${EODHD_CALLS_PER_RUN} calls spent)`;

  const { lastBar, previousSession } = await loadGapState(universe, todaySession);

  // CSPX first on a fresh run: EODHD is its only source, so it must not queue behind
  // gap healing for the daily quota. Resumed (chained) runs already did it.
  if (resume.after === "" && universe.includes(CSPX_TICKER)) {
    try {
      if (!eodhdAvailable()) throw new Error(eodhdSkipReason());
      eodhdCalls += 1;
      const bars = await fetchCspxBars(
        eodhdKey,
        healWindowFrom(lastBar.get(CSPX_TICKER) ?? null, todaySession),
      );
      if (bars.length === 0) throw new Error("No EODHD bar for CSPX.LSE");
      for (const b of bars) await upsertBar(b);
      await recordStatusSuccess(CSPX_TICKER, bars.at(-1)!.source);
      updated += 1;
    } catch (e) {
      if (isEodhdQuotaError(e)) eodhdDisabled = true;
      const message = e instanceof Error ? e.message : String(e);
      await recordStatusFailure(CSPX_TICKER, message);
      failed += 1;
      failedTickers.push(CSPX_TICKER);
    }
  }

  for (let i = startIndex; i < universe.length; i++) {
    if (ctx.budget.remainingMs() <= BUDGET_HEADROOM_MS) {
      return {
        done: false,
        cursor: {
          after: lastProcessed,
          updated,
          failed,
          failedTickers,
          finnhubDisabled,
          eodhdDisabled,
          eodhdCalls,
        } satisfies PriceHistorySyncCursor,
        detail: { updated, failed, failedTickers } satisfies PriceHistorySyncDetail,
      };
    }

    const ticker = universe[i]!;
    lastProcessed = ticker;
    if (ticker === CSPX_TICKER) continue;

    let bar: DailyBar | null = null;
    let lastError: string | null = null;

    if (!finnhubDisabled && finnhubKey) {
      for (;;) {
        try {
          await sleep(MS_BETWEEN_FINNHUB);
          bar = await fetchFinnhubDailyBar(ticker, finnhubKey);
          if (!bar) lastError = "No Finnhub quote";
        } catch (e) {
          if (
            isFinnhubRateLimit(e) &&
            !finnhubCooledDown &&
            ctx.budget.remainingMs() > FINNHUB_COOLDOWN_MS + BUDGET_HEADROOM_MS
          ) {
            finnhubCooledDown = true;
            await sleep(FINNHUB_COOLDOWN_MS);
            continue;
          }
          if (isFinnhubRateLimit(e)) {
            finnhubDisabled = true;
            lastError = e instanceof Error ? e.message : "Finnhub rate limit (429)";
          } else {
            lastError = e instanceof Error ? e.message : String(e);
          }
        }
        break;
      }
    } else if (!finnhubKey) {
      lastError = "FINNHUB_API_KEY is not set";
    } else {
      lastError = "Finnhub skipped (rate-limited earlier this run)";
    }

    if (bar && !isCurrentSessionBar(bar, todaySession)) {
      lastError = `Finnhub bar dated ${bar.date}, expected ${todaySession}`;
      bar = null;
    }

    const tickerLastBar = lastBar.get(ticker) ?? null;
    const gapped = hasGap(tickerLastBar, previousSession);

    if (bar) {
      try {
        await upsertBar(bar);
        await recordStatusSuccess(ticker, bar.source);
        updated += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failed += 1;
        failedTickers.push(ticker);
        await recordStatusFailure(ticker, message);
        continue;
      }
      // Today is in; heal earlier missing sessions while the EODHD ration lasts. A heal
      // failure never fails the ticker — today's bar already landed.
      if (gapped && eodhdKey && eodhdAvailable()) {
        try {
          await sleep(MS_BETWEEN_EODHD);
          eodhdCalls += 1;
          const healed = await fetchEodhdHistory(
            ticker,
            eodhdUsSymbol(ticker),
            healWindowFrom(tickerLastBar, todaySession),
            todaySession,
            eodhdKey,
          );
          for (const h of healed) {
            if (h.date !== todaySession) await upsertBar(h);
          }
        } catch (e) {
          if (isEodhdQuotaError(e)) eodhdDisabled = true;
        }
      }
      continue;
    }

    const eodhdOk = eodhdAvailable();
    const fallback = await fetchFallbackBars(ticker, todaySession, eodhdKey, {
      eodhdDisabled: !eodhdOk,
      eodhdSkipReason: eodhdOk ? undefined : eodhdSkipReason(),
      from: healWindowFrom(tickerLastBar, todaySession),
    });
    if (fallback.eodhdCalled) eodhdCalls += 1;
    if (fallback.eodhdQuota) eodhdDisabled = true;
    if (fallback.bars.length === 0) {
      failed += 1;
      failedTickers.push(ticker);
      await recordStatusFailure(ticker, syncFailureMessage(lastError, fallback.error));
      continue;
    }

    try {
      for (const fallbackBar of fallback.bars) {
        await upsertBar(fallbackBar);
      }
      const latest = fallback.bars.at(-1)!;
      await recordStatusSuccess(ticker, latest.source);
      updated += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failed += 1;
      failedTickers.push(ticker);
      await recordStatusFailure(ticker, message);
    }
  }

  return {
    done: true,
    detail: { updated, failed, failedTickers, eodhdCalls } satisfies PriceHistorySyncDetail,
  };
}
