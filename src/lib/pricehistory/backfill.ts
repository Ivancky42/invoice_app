import { CSPX_EODHD_SYMBOL } from "@/lib/eodhd/quote";
import { fetchEodhdHistory } from "@/lib/pricehistory/providers/eodhd";
import { fetchStooqHistory } from "@/lib/pricehistory/providers/stooq";
import { CSPX_TICKER, eodhdUsSymbol } from "@/lib/pricehistory/symbols";
import type { DailyBar } from "@/lib/pricehistory/types";

export type BackfillTickerResult = {
  ticker: string;
  provider: "eodhd" | "stooq" | "none";
  rows: number;
  firstDate: string | null;
  lastDate: string | null;
  error: string | null;
  bars: DailyBar[];
};

type PriceHistoryRow = {
  ticker: string;
  date: Date;
  open: number | null;
  close: number;
  adjClose: number | null;
  volume: bigint | null;
  source: string;
};

/** Minimal Prisma surface the batched writer needs — matches `prisma.priceHistory`. */
export type PriceHistoryWriter = {
  createMany(args: { data: PriceHistoryRow[]; skipDuplicates: boolean }): Promise<unknown>;
  upsert(args: {
    where: { ticker_date: { ticker: string; date: Date } };
    create: PriceHistoryRow;
    update: Omit<PriceHistoryRow, "ticker" | "date">;
  }): Promise<unknown>;
};

function toDateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function toBigIntOrNull(volume: number | undefined): bigint | null {
  if (volume === undefined || !Number.isFinite(volume)) return null;
  return BigInt(Math.round(volume));
}

function summarize(
  ticker: string,
  provider: "eodhd" | "stooq" | "none",
  bars: DailyBar[],
  error: string | null,
): BackfillTickerResult {
  const dates = bars.map((b) => b.date).sort();
  return {
    ticker,
    provider,
    rows: bars.length,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    error,
    bars,
  };
}

/**
 * Fetch up to `days` calendar days of EOD history for one ticker: EODHD first
 * (`{TICKER}.US`, CSPX via `CSPX.LSE`), stooq fallback on EODHD failure
 * (CSPX has no stooq fallback — EODHD/LSE is its only source).
 */
export async function backfillTicker(
  ticker: string,
  days: number,
  eodhdKey: string | undefined,
): Promise<BackfillTickerResult> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const fromYmd = from.toISOString().slice(0, 10);
  const toYmd = to.toISOString().slice(0, 10);
  const isCspx = ticker === CSPX_TICKER;
  const eodhdSymbol = isCspx ? CSPX_EODHD_SYMBOL : eodhdUsSymbol(ticker);

  if (!eodhdKey) {
    if (isCspx) return summarize(ticker, "none", [], "EODHD_API_KEY is not set");
    try {
      const bars = await fetchStooqHistory(ticker, fromYmd, toYmd);
      return summarize(ticker, "stooq", bars, bars.length === 0 ? "stooq: no rows" : null);
    } catch (e) {
      return summarize(ticker, "none", [], e instanceof Error ? e.message : String(e));
    }
  }

  try {
    const bars = await fetchEodhdHistory(ticker, eodhdSymbol, fromYmd, toYmd, eodhdKey);
    if (bars.length === 0) {
      return summarize(ticker, "eodhd", [], "eodhd: no rows");
    }
    return summarize(ticker, "eodhd", bars, null);
  } catch (e) {
    const eodhdError = e instanceof Error ? e.message : String(e);
    if (isCspx) return summarize(ticker, "eodhd", [], eodhdError);
    try {
      const bars = await fetchStooqHistory(ticker, fromYmd, toYmd);
      if (bars.length === 0) {
        return summarize(ticker, "stooq", [], `${eodhdError}; stooq: no rows`);
      }
      return summarize(ticker, "stooq", bars, null);
    } catch (stooqE) {
      const stooqError = stooqE instanceof Error ? stooqE.message : String(stooqE);
      return summarize(ticker, "none", [], `${eodhdError}; ${stooqError}`);
    }
  }
}

/** Cap on concurrent upserts per batch when overwriting (avoids a sequential row crawl). */
const OVERWRITE_CONCURRENCY = 25;

/**
 * Writes one ticker's bars. Default: a single `createMany`, idempotent via
 * `skipDuplicates` (existing rows are left alone). With `overwrite`, per-row
 * upserts replace every column of an existing `(ticker, date)` row — the repair
 * path for a bad nightly bar. Unlike the nightly `mergeBarUpdate` (which leaves
 * enrichment columns untouched when the incoming bar is sparse), backfill bars
 * come from the richer EOD provider, so a full overwrite is correct here.
 */
export async function writeBackfillBars(
  writer: PriceHistoryWriter,
  bars: DailyBar[],
  options: { overwrite?: boolean } = {},
): Promise<void> {
  if (bars.length === 0) return;
  const rows = bars.map((bar) => ({
    ticker: bar.ticker,
    date: toDateOnly(bar.date),
    open: bar.open ?? null,
    close: bar.close,
    adjClose: bar.adjClose ?? null,
    volume: toBigIntOrNull(bar.volume),
    source: bar.source,
  }));

  if (!options.overwrite) {
    await writer.createMany({ data: rows, skipDuplicates: true });
    return;
  }

  for (let i = 0; i < rows.length; i += OVERWRITE_CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + OVERWRITE_CONCURRENCY).map((row) =>
        writer.upsert({
          where: { ticker_date: { ticker: row.ticker, date: row.date } },
          create: row,
          update: {
            open: row.open,
            close: row.close,
            adjClose: row.adjClose,
            volume: row.volume,
            source: row.source,
          },
        }),
      ),
    );
  }
}
