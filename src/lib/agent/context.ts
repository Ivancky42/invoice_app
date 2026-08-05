import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  getAgentRuntimeConfig,
  CONFIG_KEYS,
} from "@/lib/stocks/config";
import {
  getPortfolio,
  getWatchlist,
  getTrades,
  getTrends,
  getIdeas,
} from "@/lib/stocks/db";
import {
  computePortfolioTotals,
  exCspxNavFromTotals,
  positionWeightPctExCspx,
  resolvePositionShares,
  snapshotDateGMT8,
} from "@/lib/stocks/portfolioTotals";
import {
  decToNum,
  holdingsByTicker,
  isCashTicker,
} from "@/lib/stocks/format";
import { listStockEnums } from "@/lib/agent/enums";
import {
  earningsRiskFromDays,
  type DerivedEarningsRisk,
} from "@/lib/stocks/derived";
import type { Portfolio, Watchlist, Trade, Trend, Idea } from "@/generated/prisma/client";
import type { Decimal } from "@/generated/prisma/internal/prismaNamespace";
import type { EarningsRiskThresholds } from "@/lib/stocks/derived";

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

function earningsFields(
  earningsDate: Date | null | undefined,
  storedDays: number | null | undefined,
  thresholds: EarningsRiskThresholds,
): {
  earningsDate: string | null;
  daysToEarnings: number | null;
  earningsRisk: DerivedEarningsRisk | null;
  earningsStale: boolean;
} {
  const isoDate = iso(earningsDate);
  if (!earningsDate) {
    return {
      earningsDate: null,
      daysToEarnings: null,
      earningsRisk: null,
      earningsStale: false,
    };
  }
  const today = snapshotDateGMT8();
  const earnDay = snapshotDateGMT8(earningsDate);
  const days = Math.round((earnDay.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) {
    return {
      earningsDate: isoDate,
      daysToEarnings: null,
      earningsRisk: null,
      earningsStale: true,
    };
  }
  const daysToEarnings = storedDays ?? days;
  return {
    earningsDate: isoDate,
    daysToEarnings,
    earningsRisk: earningsRiskFromDays(daysToEarnings, thresholds),
    earningsStale: false,
  };
}

export type SyncRunSummary = {
  source: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** Present on notion when Phase 5 freeze is active — lastSuccessAt is historical only. */
  frozen?: boolean;
};

async function lastRunSummary(): Promise<{
  prices: SyncRunSummary | null;
  notion: SyncRunSummary | null;
}> {
  const rows = await prisma.syncStatus.findMany({
    where: { source: { in: ["prices", "notion"] } },
  });
  const bySource = new Map(rows.map((r) => [r.source, r]));
  const map = (source: string): SyncRunSummary | null => {
    const row = bySource.get(source);
    if (!row) return null;
    return {
      source,
      lastRunAt: iso(row.lastRunAt),
      lastSuccessAt: iso(row.lastSuccessAt),
      lastError: row.lastError,
    };
  };
  const notionFrozen = process.env.NOTION_SYNC_ENABLED !== "true";
  const notion = map("notion");
  return {
    prices: map("prices"),
    notion: notion
      ? {
          ...notion,
          frozen: notionFrozen,
          lastError: notionFrozen
            ? "notion sync frozen — lastSuccessAt is historical; cron removed"
            : notion.lastError,
        }
      : notionFrozen
        ? {
            source: "notion",
            lastRunAt: null,
            lastSuccessAt: null,
            lastError: "notion sync frozen — cron removed",
            frozen: true,
          }
        : null,
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

export function serializeWatchlistRow(
  w: Watchlist,
  opts?: { earningsRiskThresholds?: EarningsRiskThresholds },
) {
  const earn = opts?.earningsRiskThresholds
    ? earningsFields(w.earningsDate, w.daysToEarnings, opts.earningsRiskThresholds)
    : null;
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
    earningsDate: earn ? earn.earningsDate : iso(w.earningsDate),
    daysToEarnings: earn ? earn.daysToEarnings : w.daysToEarnings,
    earningsRisk: earn ? earn.earningsRisk : null,
    earningsStale: earn ? earn.earningsStale : false,
    /** Legacy Notion emoji string — prefer earningsRisk (derived). */
    earningsRiskRaw: w.earningsRisk,
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
  const priceReliable = Boolean(i.leadTicker?.trim());
  return {
    id: i.id,
    stockSector: i.stockSector,
    leadTicker: i.leadTicker,
    company: i.company,
    theme: i.theme,
    // Only trust currentPrice when leadTicker is set (sector rows often had junk quotes).
    currentPrice: priceReliable ? num(i.currentPrice) : null,
    priceReliable,
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
  const exCspxNav = exCspxNavFromTotals(totals);

  return portfolio
    .filter((p) => !isCashTicker(p.ticker))
    .map((p) => {
      const shares = resolvePositionShares(p, holdings);
      const cur = decToNum(p.currentPrice);
      const marketValue =
        shares !== null && cur !== null ? shares * cur : null;
      const weightPct = positionWeightPctExCspx(marketValue, p.ticker, exCspxNav);
      return serializePortfolioRow(p, {
        sharesOverride: shares,
        weightPct,
        marketValue,
      });
    });
}

export async function listWatchlistItems() {
  const [rows, thresholds] = await Promise.all([
    getWatchlist(),
    getAgentRuntimeConfig().then((c) => c.earningsRiskThresholds),
  ]);
  return rows.map((w) =>
    serializeWatchlistRow(w, { earningsRiskThresholds: thresholds }),
  );
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

  // Batched: 1 Config query (+ optional cash fallback) + 5 table reads + 1 SyncStatus.
  // Previously fanned out to ~12–13 concurrent queries (pool pressure on cold Neon).
  const [runtime, portfolio, trades, watchlist, trends, ideas, lastRun] =
    await Promise.all([
      getAgentRuntimeConfig(),
      getPortfolio(),
      getTrades(),
      getWatchlist(),
      getTrends(),
      getIdeas(),
      lastRunSummary(),
    ]);

  const {
    cash,
    limits,
    sentimentThresholds,
    earningsRiskThresholds,
    trackedTickers,
  } = runtime;

  const holdings = holdingsByTicker(trades);
  const totals = computePortfolioTotals(portfolio, trades);
  const exCspxNav = exCspxNavFromTotals(totals);

  const positions = portfolio
    .filter((p) => !isCashTicker(p.ticker))
    .map((p) => {
      const shares = resolvePositionShares(p, holdings);
      const cur = decToNum(p.currentPrice);
      const marketValue =
        shares !== null && cur !== null ? shares * cur : null;
      const weightPct = positionWeightPctExCspx(marketValue, p.ticker, exCspxNav);
      const earn = earningsFields(
        p.earningsDate,
        p.daysToEarnings,
        earningsRiskThresholds,
      );
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
        averageDownsUsed: p.addsUsed ?? 0,
        earningsDate: earn.earningsDate,
        daysToEarnings: earn.daysToEarnings,
        earningsRisk: earn.earningsRisk,
        earningsStale: earn.earningsStale,
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
      exCspxNav,
      unrealizedPnl: totals.unrealizedPnl,
      hasPnl: totals.hasPnl,
    },
    positions,
    watchlist: watchlist.map((w) =>
      serializeWatchlistRow(w, { earningsRiskThresholds }),
    ),
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
