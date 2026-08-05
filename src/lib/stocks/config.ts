import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  DEFAULT_EARNINGS_RISK,
  DEFAULT_SENTIMENT,
  type EarningsRiskThresholds,
  type SentimentThresholds,
} from "@/lib/stocks/derived";
import { notionCashBalanceUsd } from "@/lib/stocks/format";

export const CONFIG_KEYS = {
  CASH_POSITION_USD: "CASH_POSITION_USD",
  CASH_POSITION_MYR: "CASH_POSITION_MYR",
  FX_RATE_USD_MYR: "FX_RATE_USD_MYR",
  CASH_LAST_UPDATED: "CASH_LAST_UPDATED",
  LIMITS: "LIMITS",
  SENTIMENT_THRESHOLDS: "SENTIMENT_THRESHOLDS",
  EARNINGS_RISK_THRESHOLDS: "EARNINGS_RISK_THRESHOLDS",
  TRACKED_TICKERS: "TRACKED_TICKERS",
} as const;

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS] | string;

export type TierBands = {
  TEST_STARTER: [number, number];
  CONFIRMATION: [number, number];
  CONVICTION: [number, number];
};

export type LimitsConfig = {
  singlePositionPct: number;
  themePct: number;
  cashFloorPct: number;
  maxAverageDowns: number;
  tierBands: TierBands;
};

export type CashConfig = {
  usd: number;
  myr: number;
  fxRate: number;
  lastUpdated: string | null;
};

export type TrackedTickersConfig = {
  portfolio: string[];
  watchlist: string[];
};

export const DEFAULT_LIMITS: LimitsConfig = {
  singlePositionPct: 0.15,
  themePct: 0.3,
  cashFloorPct: 0.05,
  maxAverageDowns: 2,
  tierBands: {
    TEST_STARTER: [0.02, 0.03],
    CONFIRMATION: [0.05, 0.06],
    CONVICTION: [0, 0.08],
  },
};

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function parseTierBand(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  return [asNumber(value[0], fallback[0]), asNumber(value[1], fallback[1])];
}

function parseLimits(value: unknown): LimitsConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const bands =
    o.tierBands && typeof o.tierBands === "object" && !Array.isArray(o.tierBands)
      ? (o.tierBands as Record<string, unknown>)
      : {};
  return {
    singlePositionPct: asNumber(o.singlePositionPct, DEFAULT_LIMITS.singlePositionPct),
    themePct: asNumber(o.themePct, DEFAULT_LIMITS.themePct),
    cashFloorPct: asNumber(o.cashFloorPct, DEFAULT_LIMITS.cashFloorPct),
    maxAverageDowns: asNumber(o.maxAverageDowns, DEFAULT_LIMITS.maxAverageDowns),
    tierBands: {
      TEST_STARTER: parseTierBand(bands.TEST_STARTER, DEFAULT_LIMITS.tierBands.TEST_STARTER),
      CONFIRMATION: parseTierBand(bands.CONFIRMATION, DEFAULT_LIMITS.tierBands.CONFIRMATION),
      CONVICTION: parseTierBand(bands.CONVICTION, DEFAULT_LIMITS.tierBands.CONVICTION),
    },
  };
}

function parseSentiment(value: unknown): SentimentThresholds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  return {
    veryBullish: asNumber(o.veryBullish, DEFAULT_SENTIMENT.veryBullish),
    bullish: asNumber(o.bullish, DEFAULT_SENTIMENT.bullish),
    neutral: asNumber(o.neutral, DEFAULT_SENTIMENT.neutral),
  };
}

function parseEarningsRisk(value: unknown): EarningsRiskThresholds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  return {
    imminentMaxDays: asNumber(o.imminentMaxDays, DEFAULT_EARNINGS_RISK.imminentMaxDays),
    soonMaxDays: asNumber(o.soonMaxDays, DEFAULT_EARNINGS_RISK.soonMaxDays),
  };
}

/** Raw JSON value for a Config key, or null if missing. */
export async function getConfig(key: ConfigKey): Promise<Prisma.JsonValue | null> {
  const row = await prisma.config.findUnique({ where: { key } });
  return row?.value ?? null;
}

/** Upsert a Config key (idempotent). */
export async function setConfig(key: ConfigKey, value: Prisma.InputJsonValue): Promise<void> {
  await prisma.config.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getLimits(): Promise<LimitsConfig> {
  const raw = await getConfig(CONFIG_KEYS.LIMITS);
  return parseLimits(raw) ?? DEFAULT_LIMITS;
}

export async function getSentimentThresholds(): Promise<SentimentThresholds> {
  const raw = await getConfig(CONFIG_KEYS.SENTIMENT_THRESHOLDS);
  return parseSentiment(raw) ?? DEFAULT_SENTIMENT;
}

export async function getEarningsRiskThresholds(): Promise<EarningsRiskThresholds> {
  const raw = await getConfig(CONFIG_KEYS.EARNINGS_RISK_THRESHOLDS);
  return parseEarningsRisk(raw) ?? DEFAULT_EARNINGS_RISK;
}

function cashFromRaw(
  usdRaw: Prisma.JsonValue | null | undefined,
  myrRaw: Prisma.JsonValue | null | undefined,
  fxRaw: Prisma.JsonValue | null | undefined,
  updatedRaw: Prisma.JsonValue | null | undefined,
): Omit<CashConfig, "usd"> & { usd: number | null } {
  const fxRate = asNumber(fxRaw, 4.2);
  let usd: number | null = null;
  if (usdRaw !== null && usdRaw !== undefined) {
    const n = asNumber(usdRaw, Number.NaN);
    if (Number.isFinite(n)) usd = n;
  }
  const myrStored = asNumber(myrRaw, Number.NaN);
  return {
    usd,
    myr: Number.isFinite(myrStored) ? myrStored : (usd ?? 0) * fxRate,
    fxRate,
    lastUpdated: asString(updatedRaw),
  };
}

async function resolveCashUsdFallback(usd: number | null): Promise<number> {
  // Missing Config only — explicit 0 is a valid cash balance (do not resurrect from CASH_USD).
  if (usd !== null) return usd;
  const cashRow = await prisma.portfolio.findFirst({
    where: { ticker: { equals: "CASH_USD", mode: "insensitive" } },
  });
  if (cashRow) {
    return notionCashBalanceUsd(cashRow.currentPrice, cashRow.myAvgCost);
  }
  return 0;
}

export async function getCash(): Promise<CashConfig> {
  const [usdRaw, myrRaw, fxRaw, updatedRaw] = await Promise.all([
    getConfig(CONFIG_KEYS.CASH_POSITION_USD),
    getConfig(CONFIG_KEYS.CASH_POSITION_MYR),
    getConfig(CONFIG_KEYS.FX_RATE_USD_MYR),
    getConfig(CONFIG_KEYS.CASH_LAST_UPDATED),
  ]);
  const partial = cashFromRaw(usdRaw, myrRaw, fxRaw, updatedRaw);
  const usd = await resolveCashUsdFallback(partial.usd);
  const myrStored = asNumber(myrRaw, Number.NaN);
  return {
    usd,
    myr: Number.isFinite(myrStored) ? myrStored : usd * partial.fxRate,
    fxRate: partial.fxRate,
    lastUpdated: partial.lastUpdated,
  };
}

export async function getTrackedTickers(): Promise<TrackedTickersConfig> {
  const raw = await getConfig(CONFIG_KEYS.TRACKED_TICKERS);
  return parseTrackedTickers(raw);
}

function parseTrackedTickers(raw: Prisma.JsonValue | null | undefined): TrackedTickersConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { portfolio: [], watchlist: [] };
  }
  const o = raw as Record<string, unknown>;
  return {
    portfolio: asStringArray(o.portfolio),
    watchlist: asStringArray(o.watchlist),
  };
}

/**
 * One Config round-trip for agent context (cash + limits + thresholds + tracked).
 * Avoids the N+1 getConfig fan-out inside buildAgentContext.
 */
export async function getAgentRuntimeConfig(): Promise<{
  cash: CashConfig;
  limits: LimitsConfig;
  sentimentThresholds: SentimentThresholds;
  earningsRiskThresholds: EarningsRiskThresholds;
  trackedTickers: TrackedTickersConfig;
}> {
  const keys = Object.values(CONFIG_KEYS);
  const rows = await prisma.config.findMany({ where: { key: { in: [...keys] } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const partial = cashFromRaw(
    map.get(CONFIG_KEYS.CASH_POSITION_USD),
    map.get(CONFIG_KEYS.CASH_POSITION_MYR),
    map.get(CONFIG_KEYS.FX_RATE_USD_MYR),
    map.get(CONFIG_KEYS.CASH_LAST_UPDATED),
  );
  const usd = await resolveCashUsdFallback(partial.usd);
  const myrStored = asNumber(map.get(CONFIG_KEYS.CASH_POSITION_MYR), Number.NaN);

  return {
    cash: {
      usd,
      myr: Number.isFinite(myrStored) ? myrStored : usd * partial.fxRate,
      fxRate: partial.fxRate,
      lastUpdated: partial.lastUpdated,
    },
    limits: parseLimits(map.get(CONFIG_KEYS.LIMITS) ?? null) ?? DEFAULT_LIMITS,
    sentimentThresholds:
      parseSentiment(map.get(CONFIG_KEYS.SENTIMENT_THRESHOLDS) ?? null) ?? DEFAULT_SENTIMENT,
    earningsRiskThresholds:
      parseEarningsRisk(map.get(CONFIG_KEYS.EARNINGS_RISK_THRESHOLDS) ?? null) ??
      DEFAULT_EARNINGS_RISK,
    trackedTickers: parseTrackedTickers(map.get(CONFIG_KEYS.TRACKED_TICKERS)),
  };
}

/** Re-export defaults used by derived helpers for callers that need both. */
export { DEFAULT_SENTIMENT, DEFAULT_EARNINGS_RISK };
