import type { DailyBar } from "@/lib/pricehistory/types";

type EodhdRow = {
  date?: string;
  open?: number | string | null;
  close?: number | string | null;
  adjusted_close?: number | string | null;
  volume?: number | string | null;
};

function toNum(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function mapEodhdRow(ticker: string, row: EodhdRow): DailyBar | null {
  const close = toNum(row.close);
  if (!row.date || close === undefined || close <= 0) return null;
  return {
    ticker,
    date: row.date,
    open: toNum(row.open),
    close,
    adjClose: toNum(row.adjusted_close),
    volume: toNum(row.volume),
    source: "eodhd",
  };
}

/**
 * EODHD end-of-day history for one symbol (e.g. `AAPL.US`, `CSPX.LSE`), mapped
 * to `ticker` (the plain house ticker, not the exchange-suffixed EODHD symbol).
 * @see https://eodhistoricaldata.com/financial-apis/api-for-historical-data-and-volumes/
 */
export async function fetchEodhdHistory(
  ticker: string,
  eodhdSymbol: string,
  from: string,
  to: string,
  apiKey: string,
): Promise<DailyBar[]> {
  const key = apiKey.trim();
  if (!key) throw new Error(`eodhd ${eodhdSymbol}: EODHD_API_KEY is not set`);

  const u = new URL(`https://eodhistoricaldata.com/api/eod/${encodeURIComponent(eodhdSymbol)}`);
  u.searchParams.set("api_token", key);
  u.searchParams.set("fmt", "json");
  u.searchParams.set("from", from);
  u.searchParams.set("to", to);

  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        `eodhd ${eodhdSymbol}: 403 (plan likely does not cover this exchange/symbol)`,
      );
    }
    if (res.status === 402) {
      throw new Error(`eodhd ${eodhdSymbol}: 402 (API quota/plan limit reached)`);
    }
    if (res.status === 404) {
      throw new Error(`eodhd ${eodhdSymbol}: 404 (symbol not found)`);
    }
    throw new Error(`eodhd ${eodhdSymbol}: HTTP ${res.status}`);
  }

  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => mapEodhdRow(ticker, row as EodhdRow))
    .filter((bar): bar is DailyBar => bar !== null);
}
