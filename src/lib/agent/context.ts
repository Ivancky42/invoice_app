import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  getCash,
  getLimits,
  getSentimentThresholds,
  getEarningsRiskThresholds,
  getTrackedTickers,
  CONFIG_KEYS,
} from "@/lib/stocks/config";
import {
  getPortfolio,
  getWatchlist,
  getTrades,
  getTrends,
  getIdeas,
  getSyncStatus,
} from "@/lib/stocks/db";
import {
  computePortfolioTotals,
  resolvePositionShares,
} from "@/lib/stocks/portfolioTotals";
import {
  decToNum,
  holdingsByTicker,
  isCashTicker,
} from "@/lib/stocks/format";
import { listStockEnums } from "@/lib/agent/enums";
import type { Portfolio, Watchlist, Trade, Trend, Idea } from "@/generated/prisma/client";
import type { Decimal } from "@/generated/prisma/internal/prismaNamespace";

export const AGENT_ROUTINES = ["daily", "weekly", "earnings", "monthly"] as const;
export type AgentRoutine = (typeof AGENT_ROUTINES)[number];

export const PROMPT_NAMES = ["_shared", "daily", "weekly", "earnings", "monthly"] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

const TIMEZONE = "Asia/Kuala_Lumpur";

export function isAgentRoutine(value: string): value is AgentRoutine {
  return (AGENT_ROUTINES as readonly string[]).includes(value);
}

export function isPromptName(value: string): value is PromptName {
  return (PROMPT_NAMES as readonly string[]).includes(value);
}

export function rulesVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}

function asOfNow(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: TIMEZONE }).replace(" ", "T");
}

function num(d: Decimal | null | undefined): number | null {
  return decToNum(d);
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function jsonText(value: unknown): unknown {
  return value ?? null;
}

export type SyncRunSummary = {
  source: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
};

async function lastRunSummary(): Promise<{
  prices: SyncRunSummary | null;
  notion: SyncRunSummary | null;
}> {
  const [prices, notion] = await Promise.all([
    getSyncStatus("prices"),
    getSyncStatus("notion"),
  ]);
  const map = (row: Awaited<ReturnType<typeof getSyncStatus>>, source: string): SyncRunSummary | null => {
    if (!row) return null;
    return {
      source,
      lastRunAt: iso(row.lastRunAt),
      lastSuccessAt: iso(row.lastSuccessAt),
      lastError: row.lastError,
    };
  };
  return {
    prices: map(prices, "prices"),
    notion: map(notion, "notion"),
  };
}

export function serializePortfolioRow(
  p: Portfolio,
  opts?: { sharesOverride?: number | null; weightPct?: number | null; marketValue?: number | null },
) {
  return {
    id: p.id,
    ticker: p.ticker,
    company: p.company,
    shares: opts?.sharesOverride !== undefined ? opts.sharesOverride : num(p.shares),
    currentPrice: num(p.currentPrice),
    myAvgCost: num(p.myAvgCost),
    analystTarget: num(p.analystTarget),
    upsidePct: num(p.upsidePct),
    action: p.action,
    riskLevel: p.riskLevel,
    analystRating: p.analystRating,
    socialScore: p.socialScore,
    earningsDate: iso(p.earningsDate),
    daysToEarnings: p.daysToEarnings,
    stopLoss: num(p.stopLoss),
    entryZone: p.entryZone,
    theme: p.theme,
    marketCapBucket: p.marketCapBucket,
    sleeve: p.sleeve,
    conviction: p.conviction,
    averageDownsUsed: p.addsUsed,
    addsUsed: p.addsUsed,
    keyRisk: p.keyRisk,
    beatRate: p.beatRate,
    impliedMove: p.impliedMove,
    lastPriceUpdate: iso(p.lastPriceUpdate),
    weightPct: opts?.weightPct ?? null,
    marketValue: opts?.marketValue ?? null,
    thesis: jsonText(p.thesis),
    notes: jsonText(p.notes),
  };
}

export function serializeWatchlistRow(w: Watchlist) {
  return {
    id: w.id,
    ticker: w.ticker,
    company: w.company,
    theme: w.theme,
    priority: w.priority,
    currentPrice: num(w.currentPrice),
    analystTarget: num(w.analystTarget),
    bullTarget: num(w.bullTarget),
    upsidePct: num(w.upsidePct),
    riskLevel: w.riskLevel,
    analystRating: w.analystRating,
    socialScore: w.socialScore,
    socialPlatformBuzz: w.socialPlatformBuzz,
    earningsDate: iso(w.earningsDate),
    daysToEarnings: w.daysToEarnings,
    earningsRisk: w.earningsRisk,
    entryZone: w.entryZone,
    stopLoss: num(w.stopLoss),
    keyCatalyst: w.keyCatalyst,
    keyRisk: w.keyRisk,
    beatRate: w.beatRate,
    impliedMove: w.impliedMove,
    analystCount: w.analystCount,
    marketCapBucket: w.marketCapBucket,
    thesis: jsonText(w.thesis),
    actionNotes: jsonText(w.actionNotes),
  };
}

export function serializeTradeRow(t: Trade) {
  return {
    id: t.id,
    title: t.title,
    ticker: t.ticker,
    type: t.type,
    date: iso(t.date),
    pricePerShare: num(t.pricePerShare),
    shares: num(t.shares),
    totalValue: num(t.totalValue),
    pnlDollar: num(t.pnlDollar),
    pnlPct: num(t.pnlPct),
    status: t.status,
    avgCostBasis: num(t.avgCostBasis),
    exitReason: t.exitReason,
    idempotencyKey: t.idempotencyKey,
    thesisAtEntry: jsonText(t.thesisAtEntry),
    notes: jsonText(t.notes),
  };
}

export function serializeTrendRow(t: Trend, detail = true) {
  const base = {
    id: t.id,
    trendName: t.trendName,
    dateDiscovered: iso(t.dateDiscovered),
    representativeTickers: t.representativeTickers,
    theme: t.theme,
    lifecycleStage: t.lifecycleStage,
    signalScore: t.signalScore,
    discoveredVia: t.discoveredVia,
    weekMomentum: t.weekMomentum,
    perf1m: num(t.perf1m),
    perf3m: num(t.perf3m),
    verdict: t.verdict,
    similarToPastTrend: t.similarToPastTrend,
    keyCatalyst: t.keyCatalyst,
  };
  if (!detail) return base;
  return {
    ...base,
    scoreComponents: {
      socialVelocity: t.socialVelocity,
      analystMomentum: t.analystMomentum,
      priceClustering: t.priceClustering,
      fundamentalBacking: t.fundamentalBacking,
    },
    avoidReason: jsonText(t.avoidReason),
    notes: jsonText(t.notes),
    retrospective: jsonText(t.retrospective),
  };
}

export function serializeIdeaRow(i: Idea) {
  return {
    id: i.id,
    stockSector: i.stockSector,
    leadTicker: i.leadTicker,
    company: i.company,
    theme: i.theme,
    currentPrice: num(i.currentPrice),
    analystTarget: num(i.analystTarget),
    upsidePct: num(i.upsidePct),
    riskLevel: i.riskLevel,
    status: i.status,
    ideaStage: i.ideaStage,
    socialBuzz: i.socialBuzz,
    foundVia: i.foundVia,
    keyRisk: i.keyRisk,
    catalystDate: iso(i.catalystDate),
    dateFound: iso(i.dateFound),
    lastReviewed: iso(i.lastReviewed),
    graduationDate: iso(i.graduationDate),
    graduationPrice: num(i.graduationPrice),
    whyInteresting: jsonText(i.whyInteresting),
    notes: jsonText(i.notes),
  };
}

export async function listPortfolioPositions() {
  const [portfolio, trades] = await Promise.all([getPortfolio(), getTrades()]);
  const holdings = holdingsByTicker(trades);
  const totals = computePortfolioTotals(portfolio, trades);
  const nav = totals.totalValue;

  return portfolio
    .filter((p) => !isCashTicker(p.ticker))
    .map((p) => {
      const shares = resolvePositionShares(p, holdings);
      const cur = decToNum(p.currentPrice);
      const marketValue =
        shares !== null && cur !== null ? shares * cur : null;
      const weightPct =
        marketValue !== null && nav > 0 ? (marketValue / nav) * 100 : null;
      return serializePortfolioRow(p, {
        sharesOverride: shares,
        weightPct,
        marketValue,
      });
    });
}

export async function listWatchlistItems() {
  const rows = await getWatchlist();
  return rows.map(serializeWatchlistRow);
}

export async function listTradeItems() {
  const rows = await getTrades();
  return rows.map(serializeTradeRow);
}

export async function listIdeaItems() {
  const rows = await getIdeas();
  return rows.map(serializeIdeaRow);
}

export async function listTrendItems(detail = true) {
  const rows = await getTrends();
  return rows.map((t) => serializeTrendRow(t, detail));
}

export async function getAllConfig(): Promise<Record<string, unknown>> {
  const rows = await prisma.config.findMany({ orderBy: { key: "asc" } });
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    out[row.key] = row.value;
  }
  // Ensure known keys appear even if missing (null).
  for (const key of Object.values(CONFIG_KEYS)) {
    if (!(key in out)) out[key] = null;
  }
  return out;
}

export async function getPromptMarkdown(name: PromptName): Promise<string> {
  const filePath = path.join(process.cwd(), "prompts", `${name}.md`);
  return fs.readFile(filePath, "utf8");
}

export async function buildAgentContext(routine: AgentRoutine) {
  const trendDetail = routine !== "earnings";

  const [
    cash,
    limits,
    sentimentThresholds,
    earningsRiskThresholds,
    trackedTickers,
    portfolio,
    trades,
    watchlist,
    trends,
    ideas,
    lastRun,
  ] = await Promise.all([
    getCash(),
    getLimits(),
    getSentimentThresholds(),
    getEarningsRiskThresholds(),
    getTrackedTickers(),
    getPortfolio(),
    getTrades(),
    getWatchlist(),
    getTrends(),
    getIdeas(),
    lastRunSummary(),
  ]);

  const holdings = holdingsByTicker(trades);
  const totals = computePortfolioTotals(portfolio, trades);
  const nav = totals.totalValue;

  const positions = portfolio
    .filter((p) => !isCashTicker(p.ticker))
    .map((p) => {
      const shares = resolvePositionShares(p, holdings);
      const cur = decToNum(p.currentPrice);
      const marketValue =
        shares !== null && cur !== null ? shares * cur : null;
      const weightPct =
        marketValue !== null && nav > 0 ? (marketValue / nav) * 100 : null;
      return {
        ticker: p.ticker,
        company: p.company,
        shares,
        currentPrice: cur,
        myAvgCost: decToNum(p.myAvgCost),
        marketValue,
        weightPct,
        action: p.action,
        sleeve: p.sleeve,
        stopLoss: decToNum(p.stopLoss),
        theme: p.theme,
        averageDownsUsed: p.addsUsed,
        earningsDate: iso(p.earningsDate),
        daysToEarnings: p.daysToEarnings,
        riskLevel: p.riskLevel,
        conviction: p.conviction,
        entryZone: p.entryZone,
        upsidePct: decToNum(p.upsidePct),
      };
    });

  return {
    routine,
    rulesVersion: rulesVersion(),
    asOf: asOfNow(),
    timezone: TIMEZONE,
    cash,
    nav: {
      totalValue: totals.totalValue,
      equitiesValue: totals.equitiesValue,
      cashValue: totals.cashValue,
      unrealizedPnl: totals.unrealizedPnl,
      hasPnl: totals.hasPnl,
    },
    positions,
    watchlist: watchlist.map(serializeWatchlistRow),
    trends: trends.map((t) => serializeTrendRow(t, trendDetail)),
    ideas: ideas.map(serializeIdeaRow),
    limits,
    thresholds: {
      sentiment: sentimentThresholds,
      earningsRisk: earningsRiskThresholds,
    },
    trackedTickers,
    enums: listStockEnums(),
    lastRun,
  };
}
