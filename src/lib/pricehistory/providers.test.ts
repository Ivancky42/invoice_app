import { describe, expect, it } from "vitest";
import { CSPX_EODHD_SYMBOL } from "@/lib/eodhd/quote";
import { writeBackfillBars, type PriceHistoryWriter } from "@/lib/pricehistory/backfill";
import { easternSessionDate, fetchFinnhubDailyBar } from "@/lib/pricehistory/providers/finnhub";
import { parseStooqCsv } from "@/lib/pricehistory/providers/stooq";
import {
  absorbUniverseTicker,
  CSPX_TICKER,
  eodhdUsSymbol,
  orderPriceHistoryUniverse,
  stooqUsSymbol,
} from "@/lib/pricehistory/symbols";
import {
  isCurrentSessionBar,
  lookbackWindow,
  mergeBarUpdate,
  resumeIndex,
  sortBarsByDate,
  syncFailureMessage,
} from "@/lib/pricehistory/sync";

describe("parseStooqCsv", () => {
  it("parses a happy-path CSV", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2026-08-07,100.00,102.50,99.00,101.25,1234567\n";
    const bars = parseStooqCsv("AAPL", csv);
    expect(bars).toEqual([
      {
        ticker: "AAPL",
        date: "2026-08-07",
        open: 100,
        close: 101.25,
        volume: 1234567,
        source: "stooq",
      },
    ]);
  });

  it("returns no bars for stooq's 'No data' body", () => {
    expect(parseStooqCsv("ZZZZ", "No data\n")).toEqual([]);
    expect(parseStooqCsv("ZZZZ", "N/D\n")).toEqual([]);
  });

  it("skips malformed rows without throwing", () => {
    const csv = [
      "Date,Open,High,Low,Close,Volume",
      "not-a-date,1,2,3,4,5",
      "2026-08-07,100,102,99", // too few columns
      "2026-08-06,100.00,102.50,99.00,-5,1000", // non-positive close
      "2026-08-05,100.00,102.50,99.00,101.00,1000", // valid
    ].join("\n");
    const bars = parseStooqCsv("MSFT", csv);
    expect(bars).toHaveLength(1);
    expect(bars[0]?.date).toBe("2026-08-05");
  });

  it("returns [] for an empty body", () => {
    expect(parseStooqCsv("AAPL", "")).toEqual([]);
    expect(parseStooqCsv("AAPL", "   \n  \n")).toEqual([]);
  });
});

describe("absorbUniverseTicker", () => {
  it("adds cleaned equity symbols and skips cash", () => {
    const tickers = new Set<string>();
    absorbUniverseTicker(tickers, "oklo");
    absorbUniverseTicker(tickers, "CASH_USD");
    absorbUniverseTicker(tickers, "  ");
    expect([...tickers]).toEqual(["OKLO"]);
  });

  it("normalises CSPX and keeps idea lead tickers that are not yet on the book", () => {
    const tickers = new Set<string>();
    absorbUniverseTicker(tickers, "CSPX");
    absorbUniverseTicker(tickers, "CRWV");
    absorbUniverseTicker(tickers, "SPCX");
    expect(tickers.has(CSPX_TICKER)).toBe(true);
    expect(tickers.has("CRWV")).toBe(true);
    expect(tickers.has("SPCX")).toBe(true);
  });
});

describe("provider symbol mapping", () => {
  it("maps plain US tickers to their exchange-suffixed symbols", () => {
    expect(eodhdUsSymbol("AAPL")).toBe("AAPL.US");
    expect(stooqUsSymbol("AAPL")).toBe("aapl.us");
  });

  it("dashes dotted share classes (BRK.B) for both providers", () => {
    expect(eodhdUsSymbol("BRK.B")).toBe("BRK-B.US");
    expect(stooqUsSymbol("BRK.B")).toBe("brk-b.us");
  });

  it("leaves the CSPX exchange-suffix dot untouched (CSPX bypasses the US mapping)", () => {
    expect(CSPX_EODHD_SYMBOL).toBe("CSPX.LSE");
  });
});

describe("orderPriceHistoryUniverse", () => {
  it("puts calendar anchors first so idea leads cannot starve Finnhub", () => {
    expect(orderPriceHistoryUniverse(["CRWV", "SPY", "ALOY", "MSFT", "AAPL", "QQQ"])).toEqual([
      "AAPL",
      "MSFT",
      "QQQ",
      "SPY",
      "ALOY",
      "CRWV",
    ]);
  });

  it("puts open paper tickers after anchors and before A–Z remainder", () => {
    expect(
      orderPriceHistoryUniverse(
        ["CRWV", "SPY", "ALOY", "MSFT", "AAPL", "QQQ", "ISRG", "COIN", "VST"],
        ["VST", "ISRG", "COIN"],
      ),
    ).toEqual(["AAPL", "MSFT", "QQQ", "SPY", "COIN", "ISRG", "VST", "ALOY", "CRWV"]);
  });
});

describe("resumeIndex", () => {
  const ordered = orderPriceHistoryUniverse(["ALOY", "AAPL", "CRWV", "MSFT", "QQQ", "SPY"]);

  it("starts at 0 with no cursor", () => {
    expect(resumeIndex(ordered, "")).toBe(0);
  });

  it("resumes at the next ticker in anchors-first order", () => {
    expect(resumeIndex(ordered, "AAPL")).toBe(1);
    expect(ordered[1]).toBe("MSFT");
    expect(resumeIndex(ordered, "SPY")).toBe(4);
    expect(ordered[4]).toBe("ALOY");
  });

  it("survives a mid-chain universe insertion without skipping an anchor", () => {
    // Tick #1 processed up to MSFT; an idea lead ALOY then appears. A
    // positional / A–Z cursor would jump into the leads and skip QQQ/SPY.
    const next = orderPriceHistoryUniverse(["ABNB", "AAPL", "MSFT", "QQQ", "SPY"]);
    expect(resumeIndex(next, "MSFT")).toBe(2);
    expect(next[2]).toBe("QQQ");
  });

  it("returns universe.length when everything up to `after` is done", () => {
    expect(resumeIndex(["AAPL", "MSFT"], "MSFT")).toBe(2);
    expect(resumeIndex(["AAPL", "MSFT"], "ZZZZ")).toBe(2);
  });

  it("resumes through paper priority then into A–Z rest", () => {
    const paper = ["COIN", "ISRG"];
    const ordered = orderPriceHistoryUniverse(
      ["AAPL", "MSFT", "QQQ", "SPY", "ALOY", "COIN", "ISRG"],
      paper,
    );
    expect(ordered).toEqual(["AAPL", "MSFT", "QQQ", "SPY", "COIN", "ISRG", "ALOY"]);
    expect(resumeIndex(ordered, "SPY", paper)).toBe(4);
    expect(resumeIndex(ordered, "COIN", paper)).toBe(5);
    expect(resumeIndex(ordered, "ISRG", paper)).toBe(6);
    expect(ordered[6]).toBe("ALOY");
  });

  it("vanished paper ticker still in the priority set resumes at the next paper name", () => {
    const paper = ["COIN", "ISRG"];
    const ordered = orderPriceHistoryUniverse(
      ["AAPL", "MSFT", "QQQ", "SPY", "ALOY", "ISRG"],
      paper,
    );
    expect(resumeIndex(ordered, "COIN", paper)).toBe(ordered.indexOf("ISRG"));
  });

  it("mid-chain removal of the `after` ticker still resumes at the next one", () => {
    expect(resumeIndex(["AAPL", "SPY"], "MSFT")).toBe(1);
    const afterMissingLead = orderPriceHistoryUniverse(["AAPL", "MSFT", "QQQ", "SPY", "CRWV"]);
    expect(resumeIndex(afterMissingLead, "ALOY")).toBe(4);
    expect(afterMissingLead[4]).toBe("CRWV");
  });
});

describe("writeBackfillBars", () => {
  const bar = {
    ticker: "AAPL",
    date: "2026-08-07",
    open: 148,
    close: 150.25,
    adjClose: 150,
    volume: 1234567,
    source: "eodhd",
  } as const;

  function fakeWriter() {
    const createManyCalls: unknown[] = [];
    const upsertCalls: Parameters<PriceHistoryWriter["upsert"]>[0][] = [];
    const writer: PriceHistoryWriter = {
      async createMany(args) {
        createManyCalls.push(args);
      },
      async upsert(args) {
        upsertCalls.push(args);
      },
    };
    return { writer, createManyCalls, upsertCalls };
  }

  it("defaults to insert-only createMany with skipDuplicates", async () => {
    const { writer, createManyCalls, upsertCalls } = fakeWriter();
    await writeBackfillBars(writer, [bar]);
    expect(upsertCalls).toHaveLength(0);
    expect(createManyCalls).toHaveLength(1);
    expect(createManyCalls[0]).toMatchObject({ skipDuplicates: true });
  });

  it("with overwrite, upserts the full provider bar so a bad nightly row is repaired", async () => {
    const { writer, createManyCalls, upsertCalls } = fakeWriter();
    await writeBackfillBars(writer, [bar], { overwrite: true });
    expect(createManyCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]?.update).toEqual({
      open: 148,
      close: 150.25,
      adjClose: 150,
      volume: 1234567n,
      source: "eodhd",
    });
  });
});

describe("mergeBarUpdate", () => {
  it("leaves enrichment columns untouched for a sparse finnhub bar (no null degradation)", () => {
    const update = mergeBarUpdate({
      ticker: "AAPL",
      date: "2026-08-07",
      open: 148,
      close: 150.25,
      source: "finnhub",
    });
    // `undefined` means Prisma skips the column, preserving eodhd's adjClose/volume.
    expect(update).toEqual({
      open: 148,
      close: 150.25,
      adjClose: undefined,
      volume: undefined,
      source: "finnhub",
    });
  });

  it("does not null out open when the incoming bar lacks it", () => {
    const update = mergeBarUpdate({
      ticker: "AAPL",
      date: "2026-08-07",
      close: 150.25,
      source: "finnhub",
    });
    expect(update.open).toBeUndefined();
  });

  it("writes adjClose and volume when the incoming bar carries them", () => {
    const update = mergeBarUpdate({
      ticker: "AAPL",
      date: "2026-08-07",
      open: 100,
      close: 101,
      adjClose: 100.5,
      volume: 1234567,
      source: "eodhd",
    });
    expect(update).toEqual({
      open: 100,
      close: 101,
      adjClose: 100.5,
      volume: 1234567n,
      source: "eodhd",
    });
  });
});

describe("lookbackWindow", () => {
  it("returns an inclusive window ending on the given session date", () => {
    expect(lookbackWindow("2026-08-13", 7)).toEqual({ from: "2026-08-06", to: "2026-08-13" });
  });

  it("crosses month boundaries in UTC", () => {
    expect(lookbackWindow("2026-08-03", 7)).toEqual({ from: "2026-07-27", to: "2026-08-03" });
  });
});

describe("isCurrentSessionBar", () => {
  const bar = {
    ticker: "MSFT",
    date: "2026-08-10",
    close: 506.06,
    source: "finnhub" as const,
  };

  it("accepts a bar dated the expected session", () => {
    expect(isCurrentSessionBar(bar, "2026-08-10")).toBe(true);
  });

  it("rejects a prior-session Finnhub stamp so the run falls through to EODHD", () => {
    expect(isCurrentSessionBar(bar, "2026-08-13")).toBe(false);
  });
});

describe("sortBarsByDate / syncFailureMessage", () => {
  it("orders newest last so at(-1) is the latest session", () => {
    const sorted = sortBarsByDate([
      { ticker: "OKLO", date: "2026-08-13", close: 46.45, source: "eodhd" },
      { ticker: "OKLO", date: "2026-08-10", close: 44.49, source: "eodhd" },
    ]);
    expect(sorted.map((b) => b.date)).toEqual(["2026-08-10", "2026-08-13"]);
  });

  it("keeps both Finnhub and fallback reasons", () => {
    expect(syncFailureMessage("No Finnhub quote", "eodhd: 402")).toBe(
      "No Finnhub quote; eodhd: 402",
    );
    expect(syncFailureMessage(null, null)).toBe("unknown error");
  });
});

describe("isEodhdQuotaError", () => {
  it("matches the 402 quota error and ignores other EODHD failures", async () => {
    const { isEodhdQuotaError } = await import("@/lib/pricehistory/providers/eodhd");
    expect(isEodhdQuotaError(new Error("eodhd AAPL.US: 402 (API quota/plan limit reached)"))).toBe(
      true,
    );
    expect(isEodhdQuotaError(new Error("eodhd AAPL.US: 403 (plan likely does not cover this exchange/symbol)"))).toBe(
      false,
    );
    expect(isEodhdQuotaError(new Error("No Finnhub quote"))).toBe(false);
  });
});

describe("easternSessionDate", () => {
  it("derives the US Eastern calendar date from an epoch-seconds timestamp", () => {
    // 2026-08-07 20:00:00 UTC = 16:00 EDT (UTC-4) same day.
    const t = Math.floor(Date.UTC(2026, 7, 7, 20, 0, 0) / 1000);
    expect(easternSessionDate(t)).toBe("2026-08-07");
  });

  it("rolls back a date for a late-UTC timestamp that is still Eastern's previous day", () => {
    // 2026-08-08 02:00:00 UTC = 2026-08-07 22:00 EDT.
    const t = Math.floor(Date.UTC(2026, 7, 8, 2, 0, 0) / 1000);
    expect(easternSessionDate(t)).toBe("2026-08-07");
  });
});

describe("fetchFinnhubDailyBar", () => {
  const nowSec = Math.floor(Date.now() / 1000);

  function stubFetch(json: unknown, ok = true) {
    return async () =>
      ({
        ok,
        json: async () => json,
      }) as Response;
  }

  it("maps a fresh, valid quote to a bar dated by its own timestamp", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({ c: 150.25, o: 148.0, h: 151, l: 147, pc: 149, t: nowSec }) as typeof fetch;
    try {
      const bar = await fetchFinnhubDailyBar("AAPL", "key");
      expect(bar).toMatchObject({ ticker: "AAPL", close: 150.25, open: 148, source: "finnhub" });
      expect(bar?.date).toBe(easternSessionDate(nowSec));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a quote with c <= 0", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({ c: 0, o: 1, t: nowSec }) as typeof fetch;
    try {
      expect(await fetchFinnhubDailyBar("AAPL", "key")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a stale timestamp (> 3 days old)", async () => {
    const originalFetch = globalThis.fetch;
    const staleT = nowSec - 4 * 24 * 60 * 60;
    globalThis.fetch = stubFetch({ c: 150, o: 148, t: staleT }) as typeof fetch;
    try {
      expect(await fetchFinnhubDailyBar("AAPL", "key")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws FinnhubRateLimitError on HTTP 429 so the nightly run can stop calling Finnhub", async () => {
    const { FinnhubRateLimitError, isFinnhubRateLimit } = await import("@/lib/finnhub/quote");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({ ok: false, status: 429, json: async () => ({}) }) as Response) as typeof fetch;
    try {
      await expect(fetchFinnhubDailyBar("MSFT", "key")).rejects.toBeInstanceOf(FinnhubRateLimitError);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(isFinnhubRateLimit(new FinnhubRateLimitError())).toBe(true);
    expect(isFinnhubRateLimit(Object.assign(new Error("Finnhub rate limit (429)"), { name: "FinnhubRateLimitError" }))).toBe(
      true,
    );
    expect(isFinnhubRateLimit(new Error("No Finnhub quote"))).toBe(false);
  });

  it("rejects a quote with a missing timestamp", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({ c: 150, o: 148 }) as typeof fetch;
    try {
      expect(await fetchFinnhubDailyBar("AAPL", "key")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("eodhd row mapping (via fetchEodhdHistory)", () => {
  it("maps rows and drops ones without a positive close", async () => {
    const { fetchEodhdHistory } = await import("@/lib/pricehistory/providers/eodhd");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => [
          { date: "2026-08-05", open: 100, close: 101, adjusted_close: 101, volume: 1000 },
          { date: "2026-08-06", open: 100, close: 0, adjusted_close: 0, volume: 1000 }, // dropped
          { date: "2026-08-07" }, // dropped (no close)
        ],
      }) as Response) as typeof fetch;
    try {
      const bars = await fetchEodhdHistory("AAPL", "AAPL.US", "2026-08-01", "2026-08-08", "key");
      expect(bars).toEqual([
        {
          ticker: "AAPL",
          date: "2026-08-05",
          open: 100,
          close: 101,
          adjClose: 101,
          volume: 1000,
          source: "eodhd",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces a distinct error for 403 (plan likely excludes the exchange)", async () => {
    const { fetchEodhdHistory } = await import("@/lib/pricehistory/providers/eodhd");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 403 }) as Response) as typeof fetch;
    try {
      await expect(
        fetchEodhdHistory("CSPX", "CSPX.LSE", "2026-08-01", "2026-08-08", "key"),
      ).rejects.toThrow(/403/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws when the API key is missing", async () => {
    const { fetchEodhdHistory } = await import("@/lib/pricehistory/providers/eodhd");
    await expect(
      fetchEodhdHistory("AAPL", "AAPL.US", "2026-08-01", "2026-08-08", ""),
    ).rejects.toThrow(/EODHD_API_KEY/);
  });
});

describe("fetchFallbackBars", () => {
  it("returns the EODHD lookback window when Finnhub is unavailable", async () => {
    const { fetchFallbackBars } = await import("@/lib/pricehistory/sync");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => [
          { date: "2026-08-13", open: 44.92, close: 46.45, adjusted_close: 46.45, volume: 9144800 },
          { date: "2026-08-10", open: 47.23, close: 44.49, adjusted_close: 44.49, volume: 14239400 },
        ],
      }) as Response) as typeof fetch;
    try {
      const result = await fetchFallbackBars("OKLO", "2026-08-13", "key");
      expect(result.error).toBeNull();
      expect(result.bars.map((b) => b.date)).toEqual(["2026-08-10", "2026-08-13"]);
      expect(result.bars.at(-1)?.date).toBe("2026-08-13");
      expect(result.bars[0]?.source).toBe("eodhd");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
