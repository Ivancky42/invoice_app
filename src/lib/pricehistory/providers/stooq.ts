import { stooqUsSymbol } from "@/lib/pricehistory/symbols";
import type { DailyBar } from "@/lib/pricehistory/types";

/** YYYY-MM-DD → YYYYMMDD (stooq's `d1`/`d2` query format). */
function toStooqDate(ymd: string): string {
  return ymd.replaceAll("-", "");
}

/**
 * Parses stooq's `Date,Open,High,Low,Close,Volume` daily CSV. Defensive: stooq
 * returns the literal body `No data` (no header) when there's nothing for the
 * range, and rows can be short/malformed on partial outages.
 */
export function parseStooqCsv(ticker: string, csv: string): DailyBar[] {
  const lines = csv
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  if (lines[0]?.toLowerCase().startsWith("no data")) return [];

  const [header, ...rows] = lines;
  if (!header?.toLowerCase().startsWith("date,")) return [];

  const bars: DailyBar[] = [];
  for (const line of rows) {
    const cols = line.split(",");
    if (cols.length < 5) continue;
    const [date, open, , , close] = cols;
    const closeNum = Number(close);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(closeNum) || closeNum <= 0) {
      continue;
    }
    const openNum = Number(open);
    const volumeNum = cols[5] !== undefined ? Number(cols[5]) : undefined;
    bars.push({
      ticker,
      date,
      open: Number.isFinite(openNum) && openNum > 0 ? openNum : undefined,
      close: closeNum,
      volume: volumeNum !== undefined && Number.isFinite(volumeNum) ? volumeNum : undefined,
      source: "stooq",
    });
  }
  return bars;
}

/**
 * Keyless stooq daily history fallback for one ticker.
 * @see https://stooq.com/db/h/
 */
export async function fetchStooqHistory(
  ticker: string,
  from: string,
  to: string,
): Promise<DailyBar[]> {
  const sym = ticker.trim();
  if (!sym) return [];
  const u = new URL("https://stooq.com/q/d/l/");
  u.searchParams.set("s", stooqUsSymbol(sym));
  u.searchParams.set("i", "d");
  u.searchParams.set("d1", toStooqDate(from));
  u.searchParams.set("d2", toStooqDate(to));

  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`stooq ${sym}: HTTP ${res.status}`);
  const csv = await res.text();
  return parseStooqCsv(ticker.trim().toUpperCase(), csv);
}

/** Today's bar via stooq (used as the nightly Finnhub fallback). */
export async function fetchStooqDailyBar(ticker: string, date: string): Promise<DailyBar | null> {
  const bars = await fetchStooqHistory(ticker, date, date);
  return bars.at(-1) ?? null;
}
