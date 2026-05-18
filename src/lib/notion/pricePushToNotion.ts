import type { PageObjectResponse } from "@notionhq/client";
import { CSPX_EODHD_SYMBOL, eodhdRealTimeClose } from "@/lib/eodhd/quote";
import { finnhubLastPrice } from "@/lib/finnhub/quote";
import { isCashTicker, isPriceSyncExcludedTicker } from "@/lib/stocks/format";
import { notionClient, notionDbId } from "@/lib/notion/client";
import { asString, readProp } from "@/lib/notion/extract";
import { queryAllPages } from "@/lib/notion/queryAll";

const MS_BETWEEN_FINNHUB = 220;
const MS_BETWEEN_NOTION = 360;

export type PricePushDetail = {
  database: string;
  pageId: string;
  tickerHint: string | null;
  symbolUsed: string | null;
  ok: boolean;
  error?: string;
  price?: number;
};

export type PricePushResult = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  details: PricePushDetail[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function todayAsiaKualaLumpur(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function pageHasNumberProperty(page: PageObjectResponse, name: string): boolean {
  const p = page.properties[name];
  return p?.type === "number";
}

function pageHasDateProperty(page: PageObjectResponse, name: string): boolean {
  const p = page.properties[name];
  return p?.type === "date";
}

/** Ticker symbols to try with Finnhub (US-style). */
function symbolCandidates(raw: string | null | undefined, mode: "stock" | "ideas" | "tickers"): string[] {
  const s = raw?.trim();
  if (!s) return [];
  if (mode === "stock" && isPriceSyncExcludedTicker(s)) return [];

  if (mode === "stock") {
    const u = s.toUpperCase().replace(/\s+/g, "");
    if (/^[A-Z0-9.]{1,12}$/.test(u)) return isPriceSyncExcludedTicker(u) ? [] : [u];
    return [];
  }

  if (mode === "tickers") {
    const parts = s.split(/[,;/|]/).map((x) => x.trim());
    const out: string[] = [];
    for (const part of parts) {
      const m = part.match(/\b([A-Z]{1,5}(?:\.[A-Z]+)?)\b/i);
      const sym = (m?.[1] ?? part.replace(/[^A-Za-z0-9.]/g, "")).toUpperCase();
      if (/^[A-Z0-9.]{1,12}$/.test(sym) && !isPriceSyncExcludedTicker(sym)) out.push(sym);
    }
    return [...new Set(out)];
  }

  // ideas: "Stock / Sector" — try full token, RHS of slash, and any ALLCAPS tickers
  const upper = s.toUpperCase();
  const candidates: string[] = [];
  const slashParts = s.split("/").map((x) => x.trim());
  const rhs = slashParts[slashParts.length - 1];
  if (rhs) {
    const fromRhs = rhs.replace(/\([^)]*\)/g, "").trim();
    const compact = fromRhs.replace(/\s+/g, "").toUpperCase();
    if (/^[A-Z0-9.]{1,12}$/.test(compact) && !isPriceSyncExcludedTicker(compact)) candidates.push(compact);
  }
  const compactAll = s.replace(/\s+/g, "");
  if (/^[A-Z0-9.]{1,12}$/.test(compactAll) && !isPriceSyncExcludedTicker(compactAll.toUpperCase())) {
    candidates.push(compactAll.toUpperCase());
  }
  for (const m of upper.matchAll(/\b([A-Z]{1,5}(?:\.[A-Z]+)?)\b/g)) {
    const sym = m[1]!;
    if (!isPriceSyncExcludedTicker(sym)) candidates.push(sym);
  }
  return [...new Set(candidates)];
}

async function resolvePriceFromCandidates(
  candidates: string[],
  apiKey: string,
  cache: Map<string, number | null>,
): Promise<{ price: number | null; symbolUsed: string | null }> {
  for (const sym of candidates) {
    const ck = cache.get(sym);
    if (ck !== undefined) {
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

type DbDef = { name: string; envKey: string; tickerProp: string; tickerMode: "stock" | "ideas" | "tickers" };

const PRICE_DATABASES: DbDef[] = [
  { name: "portfolio", envKey: "NOTION_PORTFOLIO_DB", tickerProp: "Stock", tickerMode: "stock" },
  { name: "watchlist", envKey: "NOTION_WATCHLIST_DB", tickerProp: "Stock", tickerMode: "stock" },
  { name: "ideas", envKey: "NOTION_IDEAS_DB", tickerProp: "Stock / Sector", tickerMode: "ideas" },
  {
    name: "trends",
    envKey: "NOTION_TRENDS_DB",
    tickerProp: "Representative Tickers",
    tickerMode: "tickers",
  },
];

/**
 * Fetch last prices (Finnhub; **CSPX** via EODHD `CSPX.LSE`) and PATCH Notion (**Current Price**; portfolio **Last Price Update**).
 * Does not write to Neon — run Notion → Neon sync after if you want the app DB updated.
 */
export async function runPricePushToNotion(): Promise<PricePushResult> {
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

  const notion = notionClient();
  const quoteCache = new Map<string, number | null>();
  const details: PricePushDetail[] = [];
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const db of PRICE_DATABASES) {
    let dbId: string;
    try {
      dbId = notionDbId(db.envKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${db.name}: ${msg}`);
      continue;
    }

    let pages: PageObjectResponse[];
    try {
      pages = await queryAllPages(dbId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${db.name}: query failed — ${msg}`);
      continue;
    }

    for (const page of pages) {
      if (!pageHasNumberProperty(page, "Current Price")) {
        skipped += 1;
        details.push({
          database: db.name,
          pageId: page.id,
          tickerHint: null,
          symbolUsed: null,
          ok: true,
          error: "No Current Price column (skipped)",
        });
        continue;
      }

      const rawTicker = asString(readProp(page, db.tickerProp));
      if (!rawTicker?.trim()) {
        skipped += 1;
        details.push({
          database: db.name,
          pageId: page.id,
          tickerHint: null,
          symbolUsed: null,
          ok: true,
          error: "No ticker (skipped)",
        });
        continue;
      }

      if (db.tickerMode === "stock" && isCashTicker(rawTicker)) {
        skipped += 1;
        details.push({
          database: db.name,
          pageId: page.id,
          tickerHint: rawTicker,
          symbolUsed: null,
          ok: true,
          error: "Cash row — not quoted (CASH_USD)",
        });
        continue;
      }

      let price: number;
      let symbolUsed: string | null;

      if (db.tickerMode === "stock" && rawTicker.trim().toUpperCase() === "CSPX") {
        const eodhdKey = process.env.EODHD_API_KEY?.trim();
        if (!eodhdKey) {
          skipped += 1;
          details.push({
            database: db.name,
            pageId: page.id,
            tickerHint: rawTicker,
            symbolUsed: null,
            ok: true,
            error: "CSPX requires EODHD_API_KEY (not set)",
          });
          continue;
        }
        await sleep(MS_BETWEEN_FINNHUB);
        const p = await eodhdRealTimeClose(CSPX_EODHD_SYMBOL, eodhdKey);
        if (p === null) {
          failed += 1;
          details.push({
            database: db.name,
            pageId: page.id,
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
        const candidates = symbolCandidates(rawTicker, db.tickerMode);
        if (candidates.length === 0) {
          skipped += 1;
          details.push({
            database: db.name,
            pageId: page.id,
            tickerHint: rawTicker,
            symbolUsed: null,
            ok: true,
            error: "No quotable symbol after exclusions (skipped)",
          });
          continue;
        }

        const resolved = await resolvePriceFromCandidates(candidates, apiKey, quoteCache);
        if (resolved.price === null) {
          failed += 1;
          details.push({
            database: db.name,
            pageId: page.id,
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

      const props: Record<string, { number: number } | { date: { start: string } }> = {
        "Current Price": { number: price },
      };
      if (db.name === "portfolio" && pageHasDateProperty(page, "Last Price Update")) {
        props["Last Price Update"] = { date: { start: todayAsiaKualaLumpur() } };
      }

      try {
        await notion.pages.update({ page_id: page.id, properties: props });
        updated += 1;
        details.push({
          database: db.name,
          pageId: page.id,
          tickerHint: rawTicker,
          symbolUsed,
          ok: true,
          price,
        });
      } catch (e) {
        failed += 1;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${db.name} page ${page.id}: ${msg}`);
        details.push({
          database: db.name,
          pageId: page.id,
          tickerHint: rawTicker,
          symbolUsed,
          ok: false,
          error: msg,
        });
      }

      await sleep(MS_BETWEEN_NOTION);
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
