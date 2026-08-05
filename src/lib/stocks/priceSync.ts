import { CSPX_EODHD_SYMBOL, eodhdRealTimeClose } from "@/lib/eodhd/quote";
import { finnhubLastPrice } from "@/lib/finnhub/quote";
import { prisma } from "@/lib/prisma";
import {
  isCashTicker,
  isCspxTicker,
  isPriceSyncExcludedTicker,
} from "@/lib/stocks/format";
import { snapshotDateGMT8 } from "@/lib/stocks/portfolioTotals";

const MS_BETWEEN_FINNHUB = 220;

export type PriceSyncDetail = {
  table: "portfolio" | "watchlist" | "ideas";
  id: string;
  tickerHint: string | null;
  symbolUsed: string | null;
  ok: boolean;
  error?: string;
  price?: number;
};

export type PriceSyncResult = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  details: PriceSyncDetail[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Clean US-style ticker for Finnhub (Portfolio / Watchlist). */
function stockSymbol(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (isPriceSyncExcludedTicker(s)) return null;
  const u = s.toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9.]{1,12}$/.test(u) || isPriceSyncExcludedTicker(u)) return null;
  return u;
}

/**
 * Ideas `stockSector` is often "Stock / Sector" — try RHS of slash, compact
 * full token, and ALLCAPS ticker fragments (same heuristics as the old Notion push).
 */
function ideaSymbolCandidates(raw: string | null | undefined): string[] {
  const s = raw?.trim();
  if (!s) return [];
  const upper = s.toUpperCase();
  const candidates: string[] = [];
  const slashParts = s.split("/").map((x) => x.trim());
  const rhs = slashParts[slashParts.length - 1];
  if (rhs) {
    const fromRhs = rhs.replace(/\([^)]*\)/g, "").trim();
    const compact = fromRhs.replace(/\s+/g, "").toUpperCase();
    if (/^[A-Z0-9.]{1,12}$/.test(compact) && !isPriceSyncExcludedTicker(compact)) {
      candidates.push(compact);
    }
  }
  const compactAll = s.replace(/\s+/g, "");
  if (
    /^[A-Z0-9.]{1,12}$/.test(compactAll) &&
    !isPriceSyncExcludedTicker(compactAll.toUpperCase())
  ) {
    candidates.push(compactAll.toUpperCase());
  }
  for (const m of upper.matchAll(/\b([A-Z]{1,5}(?:\.[A-Z]+)?)\b/g)) {
    const sym = m[1]!;
    if (!isPriceSyncExcludedTicker(sym)) candidates.push(sym);
  }
  return [...new Set(candidates)];
}

async function resolveFinnhubPrice(
  candidates: string[],
  apiKey: string,
  cache: Map<string, number | null>,
): Promise<{ price: number | null; symbolUsed: string | null }> {
  for (const sym of candidates) {
    if (cache.has(sym)) {
      const ck = cache.get(sym)!;
      if (ck !== null) return { price: ck, symbolUsed: sym };
      continue;
    }
    await sleep(MS_BETWEEN_FINNHUB);
    const p = await finnhubLastPrice(sym, apiKey);
    cache.set(sym, p);
    if (p !== null) return { price: p, symbolUsed: sym };
  }
  return { price: null, symbolUsed: null };
}

/**
 * Fetch last prices (Finnhub; CSPX via EODHD `CSPX.LSE`) and write to Neon
 * Portfolio / Watchlist / Ideas. Does not touch Notion.
 */
export async function runPriceSyncToNeon(): Promise<PriceSyncResult> {
  const startedAt = new Date();
  const apiKey = process.env.FINNHUB_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: ["FINNHUB_API_KEY is not set"],
      details: [],
    };
  }

  const quoteCache = new Map<string, number | null>();
  const details: PriceSyncDetail[] = [];
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const priceUpdateDay = snapshotDateGMT8();

  let cspxPrice: number | null | undefined; // undefined = not fetched yet
  async function getCspxPrice(): Promise<number | null> {
    if (cspxPrice !== undefined) return cspxPrice;
    const eodhdKey = process.env.EODHD_API_KEY?.trim();
    if (!eodhdKey) {
      cspxPrice = null;
      return null;
    }
    await sleep(MS_BETWEEN_FINNHUB);
    cspxPrice = await eodhdRealTimeClose(CSPX_EODHD_SYMBOL, eodhdKey);
    return cspxPrice;
  }

  const [portfolioRows, watchlistRows, ideaRows] = await Promise.all([
    prisma.portfolio.findMany({ select: { id: true, notionId: true, ticker: true } }),
    prisma.watchlist.findMany({ select: { id: true, notionId: true, ticker: true } }),
    prisma.idea.findMany({ select: { id: true, notionId: true, stockSector: true } }),
  ]);

  for (const row of portfolioRows) {
    const rawTicker = row.ticker;
    if (isCashTicker(rawTicker)) {
      skipped += 1;
      details.push({
        table: "portfolio",
        id: row.notionId ?? row.id,
        tickerHint: rawTicker,
        symbolUsed: null,
        ok: true,
        error: "Cash row — not quoted (CASH_USD)",
      });
      continue;
    }

    let price: number;
    let symbolUsed: string | null;

    if (isCspxTicker(rawTicker)) {
      if (!process.env.EODHD_API_KEY?.trim()) {
        skipped += 1;
        details.push({
          table: "portfolio",
          id: row.notionId ?? row.id,
          tickerHint: rawTicker,
          symbolUsed: null,
          ok: true,
          error: "CSPX requires EODHD_API_KEY (not set)",
        });
        continue;
      }
      const p = await getCspxPrice();
      if (p === null) {
        failed += 1;
        details.push({
          table: "portfolio",
          id: row.notionId ?? row.id,
          tickerHint: rawTicker,
          symbolUsed: CSPX_EODHD_SYMBOL,
          ok: false,
          error: "No EODHD quote for CSPX.LSE",
        });
        continue;
      }
      price = p;
      symbolUsed = CSPX_EODHD_SYMBOL;
    } else {
      const sym = stockSymbol(rawTicker);
      if (!sym) {
        skipped += 1;
        details.push({
          table: "portfolio",
          id: row.notionId ?? row.id,
          tickerHint: rawTicker,
          symbolUsed: null,
          ok: true,
          error: "No quotable symbol after exclusions (skipped)",
        });
        continue;
      }
      const resolved = await resolveFinnhubPrice([sym], apiKey, quoteCache);
      if (resolved.price === null) {
        failed += 1;
        details.push({
          table: "portfolio",
          id: row.notionId ?? row.id,
          tickerHint: rawTicker,
          symbolUsed: resolved.symbolUsed,
          ok: false,
          error: "No Finnhub quote",
        });
        continue;
      }
      price = resolved.price;
      symbolUsed = resolved.symbolUsed;
    }

    try {
      await prisma.portfolio.update({
        where: { id: row.id },
        data: { currentPrice: price, lastPriceUpdate: priceUpdateDay },
      });
      updated += 1;
      details.push({
        table: "portfolio",
        id: row.notionId ?? row.id,
        tickerHint: rawTicker,
        symbolUsed,
        ok: true,
        price,
      });
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`portfolio ${row.notionId ?? row.id}: ${msg}`);
      details.push({
        table: "portfolio",
        id: row.notionId ?? row.id,
        tickerHint: rawTicker,
        symbolUsed,
        ok: false,
        error: msg,
      });
    }
  }

  for (const row of watchlistRows) {
    const rawTicker = row.ticker;
    if (isCashTicker(rawTicker)) {
      skipped += 1;
      details.push({
        table: "watchlist",
        id: row.notionId ?? row.id,
        tickerHint: rawTicker,
        symbolUsed: null,
        ok: true,
        error: "Cash row — not quoted (CASH_USD)",
      });
      continue;
    }

    let price: number;
    let symbolUsed: string | null;

    if (isCspxTicker(rawTicker)) {
      if (!process.env.EODHD_API_KEY?.trim()) {
        skipped += 1;
        details.push({
          table: "watchlist",
          id: row.notionId ?? row.id,
          tickerHint: rawTicker,
          symbolUsed: null,
          ok: true,
          error: "CSPX requires EODHD_API_KEY (not set)",
        });
        continue;
      }
      const p = await getCspxPrice();
      if (p === null) {
        failed += 1;
        details.push({
          table: "watchlist",
          id: row.notionId ?? row.id,
          tickerHint: rawTicker,
          symbolUsed: CSPX_EODHD_SYMBOL,
          ok: false,
          error: "No EODHD quote for CSPX.LSE",
        });
        continue;
      }
      price = p;
      symbolUsed = CSPX_EODHD_SYMBOL;
    } else {
      const sym = stockSymbol(rawTicker);
      if (!sym) {
        skipped += 1;
        details.push({
          table: "watchlist",
          id: row.notionId ?? row.id,
          tickerHint: rawTicker,
          symbolUsed: null,
          ok: true,
          error: "No quotable symbol after exclusions (skipped)",
        });
        continue;
      }
      const resolved = await resolveFinnhubPrice([sym], apiKey, quoteCache);
      if (resolved.price === null) {
        failed += 1;
        details.push({
          table: "watchlist",
          id: row.notionId ?? row.id,
          tickerHint: rawTicker,
          symbolUsed: resolved.symbolUsed,
          ok: false,
          error: "No Finnhub quote",
        });
        continue;
      }
      price = resolved.price;
      symbolUsed = resolved.symbolUsed;
    }

    try {
      await prisma.watchlist.update({
        where: { id: row.id },
        data: { currentPrice: price },
      });
      updated += 1;
      details.push({
        table: "watchlist",
        id: row.notionId ?? row.id,
        tickerHint: rawTicker,
        symbolUsed,
        ok: true,
        price,
      });
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`watchlist ${row.notionId ?? row.id}: ${msg}`);
      details.push({
        table: "watchlist",
        id: row.notionId ?? row.id,
        tickerHint: rawTicker,
        symbolUsed,
        ok: false,
        error: msg,
      });
    }
  }

  for (const row of ideaRows) {
    const candidates = ideaSymbolCandidates(row.stockSector);
    if (candidates.length === 0) {
      skipped += 1;
      details.push({
        table: "ideas",
        id: row.notionId ?? row.id,
        tickerHint: row.stockSector,
        symbolUsed: null,
        ok: true,
        error: "No quotable symbol after exclusions (skipped)",
      });
      continue;
    }

    const resolved = await resolveFinnhubPrice(candidates, apiKey, quoteCache);
    if (resolved.price === null) {
      failed += 1;
      details.push({
        table: "ideas",
        id: row.notionId ?? row.id,
        tickerHint: row.stockSector,
        symbolUsed: resolved.symbolUsed,
        ok: false,
        error: "No Finnhub quote",
      });
      continue;
    }

    try {
      await prisma.idea.update({
        where: { id: row.id },
        data: { currentPrice: resolved.price },
      });
      updated += 1;
      details.push({
        table: "ideas",
        id: row.notionId ?? row.id,
        tickerHint: row.stockSector,
        symbolUsed: resolved.symbolUsed,
        ok: true,
        price: resolved.price,
      });
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`ideas ${row.notionId ?? row.id}: ${msg}`);
      details.push({
        table: "ideas",
        id: row.notionId ?? row.id,
        tickerHint: row.stockSector,
        symbolUsed: resolved.symbolUsed,
        ok: false,
        error: msg,
      });
    }
  }

  const completedAt = new Date();
  return {
    ok: failed === 0,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    updated,
    skipped,
    failed,
    errors,
    details,
  };
}
