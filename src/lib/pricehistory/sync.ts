import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { CSPX_EODHD_SYMBOL } from "@/lib/eodhd/quote";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import { isFinnhubRateLimit } from "@/lib/finnhub/quote";
import { fetchEodhdHistory } from "@/lib/pricehistory/providers/eodhd";
import { fetchFinnhubDailyBar, easternSessionDate } from "@/lib/pricehistory/providers/finnhub";
import { fetchStooqHistory } from "@/lib/pricehistory/providers/stooq";
import { buildPriceHistoryUniverse, CSPX_TICKER, eodhdUsSymbol } from "@/lib/pricehistory/symbols";
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

/** Same Finnhub rate-limit pacing as `priceSync.ts`'s `MS_BETWEEN_FINNHUB`. */
const MS_BETWEEN_FINNHUB = 220;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type PriceHistorySyncDetail = {
  updated: number;
  failed: number;
  failedTickers: string[];
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
});

type PriceHistorySyncCursor = z.infer<typeof cursorSchema>;

const EMPTY_CURSOR: PriceHistorySyncCursor = { after: "", updated: 0, failed: 0, failedTickers: [] };

function parseCursor(cursor: Prisma.JsonValue | null): PriceHistorySyncCursor {
  if (cursor === null) return EMPTY_CURSOR;
  const parsed = cursorSchema.safeParse(cursor);
  return parsed.success ? parsed.data : EMPTY_CURSOR;
}

/**
 * First index in the sorted universe strictly after `after` ("" = start).
 * Tickers added mid-chain that sort before `after` are picked up on the next
 * daily run; nothing from the in-progress sequence is ever skipped.
 */
export function resumeIndex(universeSorted: string[], after: string): number {
  if (after === "") return 0;
  const idx = universeSorted.findIndex((ticker) => ticker > after);
  return idx === -1 ? universeSorted.length : idx;
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
): Promise<{ bars: DailyBar[]; error: string | null }> {
  const { from, to } = lookbackWindow(todaySession);
  const errors: string[] = [];

  if (eodhdKey) {
    try {
      await sleep(MS_BETWEEN_FINNHUB);
      const bars = sortBarsByDate(
        await fetchEodhdHistory(ticker, eodhdUsSymbol(ticker), from, to, eodhdKey),
      );
      if (bars.length > 0) return { bars, error: null };
      errors.push("eodhd: no rows");
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  } else {
    errors.push("EODHD_API_KEY is not set");
  }

  try {
    const bars = sortBarsByDate(await fetchStooqHistory(ticker, from, to));
    if (bars.length > 0) return { bars, error: null };
    errors.push("stooq: no rows");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  return { bars: [], error: errors.join("; ") };
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

async function fetchCspxBar(eodhdKey: string | undefined): Promise<DailyBar | null> {
  if (!eodhdKey) throw new Error("EODHD_API_KEY is not set");
  const to = new Date();
  const from = new Date(to.getTime() - CSPX_LOOKBACK_DAYS * 86_400_000);
  const bars = await fetchEodhdHistory(
    CSPX_TICKER,
    CSPX_EODHD_SYMBOL,
    from.toISOString().slice(0, 10),
    to.toISOString().slice(0, 10),
    eodhdKey,
  );
  return bars.at(-1) ?? null;
}

/**
 * Nightly price-history sync: one bar per universe ticker for today's session.
 * Finnhub first; on miss, EODHD lookback (writes the whole window so a
 * multi-day gap heals) then stooq. CSPX only via EODHD. Idempotent upserts,
 * resumable via `cursor` when the tick budget runs low.
 */
export async function runPriceHistorySync(ctx: JobContext): Promise<JobResult> {
  const universe = await buildPriceHistoryUniverse();
  const resume = parseCursor(ctx.cursor);
  const startIndex = resumeIndex(universe, resume.after);

  const finnhubKey = process.env.FINNHUB_API_KEY?.trim();
  const eodhdKey = process.env.EODHD_API_KEY?.trim();

  let updated = resume.updated;
  let failed = resume.failed;
  const failedTickers: string[] = [...resume.failedTickers];
  let lastProcessed = resume.after;
  const todaySession = easternSessionDate(Math.floor(Date.now() / 1000));
  // price_sync already burned most of the Finnhub minute-quota; once we see a
  // 429, stop calling Finnhub for the rest of this run and heal via EODHD.
  let finnhubDisabled = resume.finnhubDisabled === true || !finnhubKey;

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
        } satisfies PriceHistorySyncCursor,
        detail: { updated, failed, failedTickers } satisfies PriceHistorySyncDetail,
      };
    }

    const ticker = universe[i]!;
    lastProcessed = ticker;

    if (ticker === CSPX_TICKER) {
      try {
        const bar = await fetchCspxBar(eodhdKey);
        if (!bar) throw new Error("No EODHD bar for CSPX.LSE");
        await upsertBar(bar);
        await recordStatusSuccess(ticker, bar.source);
        updated += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await recordStatusFailure(ticker, message);
        failed += 1;
        failedTickers.push(ticker);
      }
      continue;
    }

    let bar: DailyBar | null = null;
    let lastError: string | null = null;

    if (!finnhubDisabled && finnhubKey) {
      try {
        await sleep(MS_BETWEEN_FINNHUB);
        bar = await fetchFinnhubDailyBar(ticker, finnhubKey);
        if (!bar) lastError = "No Finnhub quote";
      } catch (e) {
        if (isFinnhubRateLimit(e)) {
          finnhubDisabled = true;
          lastError = e instanceof Error ? e.message : "Finnhub rate limit (429)";
        } else {
          lastError = e instanceof Error ? e.message : String(e);
        }
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
      }
      continue;
    }

    const fallback = await fetchFallbackBars(ticker, todaySession, eodhdKey);
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
    detail: { updated, failed, failedTickers } satisfies PriceHistorySyncDetail,
  };
}
