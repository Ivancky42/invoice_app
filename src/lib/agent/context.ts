import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  getAgentRuntimeConfig,
  getLimits,
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
  computeUpsidePct,
  decToNum,
  holdingsByTicker,
  isCashTicker,
} from "@/lib/stocks/format";
import { listStockEnums } from "@/lib/agent/enums";
import { CRON_JOBS } from "@/lib/cron/jobs";
import { getRuleSet } from "@/lib/rules/resolve";
import { shadowContextBlock } from "@/lib/shadow/read";
import { ensureContentPages } from "@/lib/agent/contentPages";
import {
  earningsRiskFromDays,
  type DerivedEarningsRisk,
} from "@/lib/stocks/derived";
import type { Branch, Portfolio, Watchlist, Trade, Trend, Idea, DecisionReview, ContentPage } from "@/generated/prisma/client";
import type { Decimal } from "@/generated/prisma/internal/prismaNamespace";
import type { EarningsRiskThresholds } from "@/lib/stocks/derived";
import {
  asReportBlocks,
  truncatePageNotes,
} from "@/lib/content/blocks";

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
      // Null is as bad as past — routines must re-confirm the next date.
      earningsStale: true,
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
  /** From SyncStatus.rowCounts when source=prices. */
  failedTickers?: string[];
  failedDetails?: Array<{ table: string; ticker: string | null; error: string }>;
  updated?: number;
  failed?: number;
};

function priceStatusFromUpdate(
  lastPriceUpdate: Date | null | undefined,
  failedTickers: Set<string>,
  ticker: string | null | undefined,
): "OK" | "STALE" | "SYNC_FAILED" | "UNKNOWN" {
  const t = ticker?.trim().toUpperCase();
  if (t && failedTickers.has(t)) return "SYNC_FAILED";
  if (!lastPriceUpdate) return "UNKNOWN";
  const today = snapshotDateGMT8();
  const markDay = snapshotDateGMT8(lastPriceUpdate);
  const ageDays = Math.round((today.getTime() - markDay.getTime()) / 86_400_000);
  // Weekend/holiday buffer: >2 calendar days behind expected close → STALE.
  if (ageDays > 2) return "STALE";
  return "OK";
}

function pageNotesPreview(body: unknown) {
  const { blocks, totalBlocks, truncated } = truncatePageNotes(body, 3);
  return {
    pageNotes: blocks,
    pageNotesTotal: totalBlocks,
    pageNotesTruncated: truncated,
  };
}

export type StaleJob = {
  job: string;
  /** UTC run day of the last SUCCESS, or null when the job has never succeeded. */
  lastSuccess: string | null;
  /** Days since that success; null when there has never been one. */
  daysBehind: number | null;
};

/** A registered cron job is stale once its last SUCCESS is older than this. */
const STALE_JOB_DAYS = 2;

/**
 * Registered cron jobs whose last SUCCESS is more than {@link STALE_JOB_DAYS} old.
 * Surfaced in context so a routine can see that (e.g.) price_history stopped feeding
 * the marks it is about to reason over, instead of trusting silently stale data.
 */
async function staleJobsSummary(): Promise<StaleJob[]> {
  const grouped = await prisma.jobRun.groupBy({
    by: ["job"],
    where: { status: "SUCCESS" },
    _max: { runDay: true },
  });
  const lastByJob = new Map(grouped.map((g) => [g.job, g._max.runDay ?? null]));

  const todayMs = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );

  const out: StaleJob[] = [];
  for (const descriptor of CRON_JOBS) {
    const last = lastByJob.get(descriptor.job) ?? null;
    if (!last) {
      out.push({ job: descriptor.job, lastSuccess: null, daysBehind: null });
      continue;
    }
    const daysBehind = Math.round((todayMs - last.getTime()) / 86_400_000);
    if (daysBehind > STALE_JOB_DAYS) {
      out.push({
        job: descriptor.job,
        lastSuccess: last.toISOString().slice(0, 10),
        daysBehind,
      });
    }
  }
  return out;
}

async function lastRunSummary(): Promise<{
  prices: SyncRunSummary | null;
  notion: SyncRunSummary | null;
  staleJobs: StaleJob[];
}> {
  const [rows, staleJobs] = await Promise.all([
    prisma.syncStatus.findMany({
      where: { source: { in: ["prices", "notion"] } },
    }),
    staleJobsSummary(),
  ]);
  const bySource = new Map(rows.map((r) => [r.source, r]));
  const map = (source: string): SyncRunSummary | null => {
    const row = bySource.get(source);
    if (!row) return null;
    const counts =
      row.rowCounts && typeof row.rowCounts === "object" && !Array.isArray(row.rowCounts)
        ? (row.rowCounts as Record<string, unknown>)
        : {};
    const failedTickers = Array.isArray(counts.failedTickers)
      ? counts.failedTickers.filter((t): t is string => typeof t === "string")
      : undefined;
    const failedDetails = Array.isArray(counts.failedDetails)
      ? (counts.failedDetails as Array<{ table: string; ticker: string | null; error: string }>)
      : undefined;
    return {
      source,
      lastRunAt: iso(row.lastRunAt),
      lastSuccessAt: iso(row.lastSuccessAt),
      lastError: row.lastError,
      failedTickers,
      failedDetails,
      updated: typeof counts.updated === "number" ? counts.updated : undefined,
      failed: typeof counts.failed === "number" ? counts.failed : undefined,
    };
  };
  const notionFrozen = process.env.NOTION_SYNC_ENABLED !== "true";
  const notion = map("notion");
  return {
    staleJobs,
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
  opts?: {
    sharesOverride?: number | null;
    weightPct?: number | null;
    marketValue?: number | null;
    failedTickers?: Set<string>;
  },
) {
  const currentPrice = num(p.currentPrice);
  const analystTarget = num(p.analystTarget);
  const storedUpside = num(p.upsidePct);
  const derivedUpside = computeUpsidePct(currentPrice, analystTarget);
  const notes = pageNotesPreview(p.pageNotes);
  const failed = opts?.failedTickers ?? new Set<string>();
  return {
    id: p.id,
    ticker: p.ticker,
    company: p.company,
    shares: opts?.sharesOverride !== undefined ? opts.sharesOverride : num(p.shares),
    currentPrice,
    myAvgCost: num(p.myAvgCost),
    analystTarget,
    // Prefer live derive so agents/UI never see write-lag fossils.
    upsidePct: derivedUpside ?? storedUpside,
    action: p.action,
    riskLevel: p.riskLevel,
    analystRating: p.analystRating,
    socialScore: p.socialScore,
    earningsDate: iso(p.earningsDate),
    daysToEarnings: p.daysToEarnings,
    stopLoss: num(p.stopLoss),
    entryZone: p.entryZone,
    addZone: p.addZone,
    nextAddTrigger: p.nextAddTrigger,
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
    priceStatus: priceStatusFromUpdate(p.lastPriceUpdate, failed, p.ticker),
    weightPct: opts?.weightPct ?? null,
    marketValue: opts?.marketValue ?? null,
    thesis: jsonText(p.thesis),
    notes: jsonText(p.notes),
    ...notes,
  };
}

export function serializeWatchlistRow(
  w: Watchlist,
  opts?: {
    earningsRiskThresholds?: EarningsRiskThresholds;
    failedTickers?: Set<string>;
  },
) {
  const earn = opts?.earningsRiskThresholds
    ? earningsFields(w.earningsDate, w.daysToEarnings, opts.earningsRiskThresholds)
    : null;
  const currentPrice = num(w.currentPrice);
  const analystTarget = num(w.analystTarget);
  const derivedUpside = computeUpsidePct(currentPrice, analystTarget);
  const notes = pageNotesPreview(w.pageNotes);
  const failed = opts?.failedTickers ?? new Set<string>();
  return {
    id: w.id,
    ticker: w.ticker,
    company: w.company,
    theme: w.theme,
    priority: w.priority,
    action: w.action,
    demotedAt: iso(w.demotedAt),
    currentPrice,
    analystTarget,
    bullTarget: num(w.bullTarget),
    upsidePct: derivedUpside ?? num(w.upsidePct),
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
    lastPriceUpdate: iso(w.lastPriceUpdate),
    priceStatus: priceStatusFromUpdate(w.lastPriceUpdate, failed, w.ticker),
    thesis: jsonText(w.thesis),
    actionNotes: jsonText(w.actionNotes),
    ...notes,
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

export function serializeIdeaRow(i: Idea, opts?: { failedTickers?: Set<string> }) {
  const priceReliable = Boolean(i.leadTicker?.trim());
  const failed = opts?.failedTickers ?? new Set<string>();
  return {
    id: i.id,
    stockSector: i.stockSector,
    leadTicker: i.leadTicker,
    company: i.company,
    theme: i.theme,
    // Only trust currentPrice when leadTicker is set (sector rows often had junk quotes).
    currentPrice: priceReliable ? num(i.currentPrice) : null,
    priceReliable,
    lastPriceUpdate: priceReliable ? iso(i.lastPriceUpdate) : null,
    priceStatus: priceReliable
      ? priceStatusFromUpdate(i.lastPriceUpdate, failed, i.leadTicker)
      : "UNKNOWN",
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
  const [portfolio, trades, lastRun] = await Promise.all([
    getPortfolio(),
    getTrades(),
    lastRunSummary(),
  ]);
  const holdings = holdingsByTicker(trades);
  const totals = computePortfolioTotals(portfolio, trades);
  const exCspxNav = exCspxNavFromTotals(totals);
  const failedTickers = new Set(lastRun.prices?.failedTickers ?? []);

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
        failedTickers,
      });
    });
}

export async function listWatchlistItems(opts?: { includeDemoted?: boolean }) {
  const [rows, thresholds, lastRun] = await Promise.all([
    getWatchlist(),
    getAgentRuntimeConfig().then((c) => c.earningsRiskThresholds),
    lastRunSummary(),
  ]);
  const failedTickers = new Set(lastRun.prices?.failedTickers ?? []);
  const filtered = opts?.includeDemoted
    ? rows
    : rows.filter((w) => w.action !== "DEMOTED" && w.action !== "DROPPED");
  return filtered.map((w) =>
    serializeWatchlistRow(w, {
      earningsRiskThresholds: thresholds,
      failedTickers,
    }),
  );
}

export function serializeDecisionReviewRow(r: DecisionReview) {
  return {
    id: r.id,
    notionId: r.notionId,
    idempotencyKey: r.idempotencyKey,
    branch: r.branch,
    title: r.title,
    ticker: r.ticker,
    decisionDate: iso(r.decisionDate),
    decisionType: r.decisionType,
    positionContext: r.positionContext,
    priceAtDecision: num(r.priceAtDecision),
    entryZone: r.entryZone,
    stopLoss: num(r.stopLoss),
    target: num(r.target),
    convictionScore: r.convictionScore,
    catalyst: r.catalyst,
    catalystDate: iso(r.catalystDate),
    originalThesis: r.originalThesis,
    expectedOutcome: r.expectedOutcome,
    keyMetricToWatch: r.keyMetricToWatch,
    reasonForDecision: r.reasonForDecision,
    riskInvalidation: r.riskInvalidation,
    sourceSignal: r.sourceSignal,
    antiPatternTags: r.antiPatternTags,
    criteriaThatWorked: r.criteriaThatWorked,
    criteriaThatFailed: r.criteriaThatFailed,
    reviewStatus: r.reviewStatus,
    outcome1w: r.outcome1w,
    outcome4w: r.outcome4w,
    outcome3m: r.outcome3m,
    return1wPct: num(r.return1wPct),
    return4wPct: num(r.return4wPct),
    return3mPct: num(r.return3mPct),
    finalVerdict: r.finalVerdict,
    signalQuality: r.signalQuality,
    executionQuality: r.executionQuality,
    lessonLearned: r.lessonLearned,
    updateStrategy: r.updateStrategy,
    rulesVersion: r.rulesVersion,
  };
}

export function serializeContentPage(row: ContentPage) {
  return {
    key: row.key,
    title: row.title,
    body: asReportBlocks(row.body),
    notionPageId: row.notionPageId,
    syncedAt: iso(row.syncedAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listContentPages() {
  await ensureContentPages();
  const rows = await prisma.contentPage.findMany({ orderBy: { key: "asc" } });
  return rows.map(serializeContentPage);
}

export async function listTradeItems() {
  const rows = await getTrades();
  return rows.map(serializeTradeRow);
}

export async function listIdeaItems() {
  const [rows, lastRun] = await Promise.all([getIdeas(), lastRunSummary()]);
  const failedTickers = new Set(lastRun.prices?.failedTickers ?? []);
  return rows.map((i) => serializeIdeaRow(i, { failedTickers }));
}

export function serializeDailyLogRow(row: {
  id: string;
  title: string;
  logDate: Date | null;
  routineType?: string | null;
  marketContext: unknown;
  topNews: unknown;
  portfolioMove: unknown;
  watchlistMove: unknown;
  actionTaken: unknown;
  notes: unknown;
  flaggedTickers: string[];
  alertEmailSent: boolean | null;
  rulesVersion: string | null;
}) {
  return {
    id: row.id,
    title: row.title,
    logDate: iso(row.logDate),
    routineType: row.routineType ?? "DAILY",
    marketContext: asReportBlocks(row.marketContext),
    topNews: asReportBlocks(row.topNews),
    portfolioMove: asReportBlocks(row.portfolioMove),
    watchlistMove: asReportBlocks(row.watchlistMove),
    actionTaken: asReportBlocks(row.actionTaken),
    notes: asReportBlocks(row.notes),
    flaggedTickers: row.flaggedTickers,
    alertEmailSent: row.alertEmailSent,
    rulesVersion: row.rulesVersion,
  };
}

export function serializeStockReportRow(row: {
  id: string;
  title: string;
  reportType: string;
  reportDate: Date | null;
  content: unknown;
  rulesVersion: string | null;
}) {
  return {
    id: row.id,
    title: row.title,
    reportType: row.reportType,
    reportDate: iso(row.reportDate),
    content: asReportBlocks(row.content),
    rulesVersion: row.rulesVersion,
  };
}

export async function listDailyLogItems(opts?: {
  since?: string;
  until?: string;
  limit?: number;
  routineType?: "DAILY" | "EARNINGS";
}) {
  const limit = opts?.limit ?? 14;
  const where: {
    logDate?: { gte?: Date; lte?: Date };
    routineType?: "DAILY" | "EARNINGS";
  } = {};
  if (opts?.routineType) where.routineType = opts.routineType;
  if (opts?.since || opts?.until) {
    where.logDate = {};
    if (opts.since) {
      where.logDate.gte = new Date(`${opts.since}T12:00:00.000Z`);
    }
    if (opts.until) {
      where.logDate.lte = new Date(`${opts.until}T12:00:00.000Z`);
    }
  }
  const rows = await prisma.dailyLog.findMany({
    where,
    orderBy: [{ logDate: "desc" }, { routineType: "asc" }],
    take: limit,
  });
  return rows.map(serializeDailyLogRow);
}

export async function listStockReportItems(opts?: {
  reportType?: "WEEKLY" | "MONTHLY";
  since?: string;
  until?: string;
  limit?: number;
}) {
  const limit = opts?.limit ?? 8;
  const where: {
    reportType?: "WEEKLY" | "MONTHLY";
    reportDate?: { gte?: Date; lte?: Date };
  } = {};
  if (opts?.reportType) where.reportType = opts.reportType;
  if (opts?.since || opts?.until) {
    where.reportDate = {};
    if (opts.since) {
      where.reportDate.gte = new Date(`${opts.since}T12:00:00.000Z`);
    }
    if (opts.until) {
      where.reportDate.lte = new Date(`${opts.until}T12:00:00.000Z`);
    }
  }
  const rows = await prisma.stockReport.findMany({
    where,
    orderBy: { reportDate: "desc" },
    take: limit,
  });
  return rows.map(serializeStockReportRow);
}

export function serializePriceHistoryRow(row: {
  ticker: string;
  date: Date;
  open: Decimal | null;
  close: Decimal;
  adjClose: Decimal | null;
  volume: bigint | null;
  source: string;
}) {
  return {
    ticker: row.ticker,
    date: iso(row.date)!.slice(0, 10),
    open: decToNum(row.open),
    close: decToNum(row.close),
    adjClose: decToNum(row.adjClose),
    volume: row.volume === null ? null : Number(row.volume),
    source: row.source,
  };
}

export async function listPriceHistoryItems(opts: {
  ticker: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const limit = opts.limit ?? 120;
  const where: {
    ticker: string;
    date?: { gte?: Date; lte?: Date };
  } = { ticker: opts.ticker.trim().toUpperCase() };
  if (opts.from || opts.to) {
    where.date = {};
    if (opts.from) where.date.gte = new Date(`${opts.from}T00:00:00.000Z`);
    if (opts.to) where.date.lte = new Date(`${opts.to}T00:00:00.000Z`);
  }
  const rows = await prisma.priceHistory.findMany({
    where,
    orderBy: { date: "desc" },
    take: limit,
  });
  return rows.map(serializePriceHistoryRow);
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
  // Normalize LIMITS through the same parser as get_context so defaults
  // (e.g. speculativeSleevePct) are visible — raw JSON may omit newer keys.
  out[CONFIG_KEYS.LIMITS] = await getLimits();
  return out;
}

/**
 * Prompt text for a routine, from the RuleVersion in force on `branch`.
 * Falls back to the committed file on disk when the ruleset is degraded or incomplete.
 */
export async function getPromptMarkdown(
  name: PromptName,
  branch: Branch = "LIVE",
): Promise<string> {
  const ruleSet = await getRuleSet(branch);
  const fromDb = ruleSet.files[`${name}.md`];
  if (typeof fromDb === "string" && fromDb.length > 0) return fromDb;

  const filePath = path.join(process.cwd(), "prompts", `${name}.md`);
  return fs.readFile(filePath, "utf8");
}

export async function buildAgentContext(routine: AgentRoutine, branch: Branch = "LIVE") {
  const trendDetail = routine !== "earnings";

  // Batched: 1 Config query (+ optional cash fallback) + 5 table reads + 1 SyncStatus.
  // Previously fanned out to ~12–13 concurrent queries (pool pressure on cold Neon).
  const [
    runtime,
    portfolio,
    trades,
    watchlistRaw,
    trends,
    ideas,
    lastRun,
    documents,
    shadow,
  ] = await Promise.all([
      getAgentRuntimeConfig(branch),
      getPortfolio(),
      getTrades(),
      getWatchlist(),
      getTrends(),
      getIdeas(),
      lastRunSummary(),
      listContentPages(),
      // Informational only: the paper book for this branch, null until it is seeded.
      shadowContextBlock(branch).catch(() => null),
    ]);

  const watchlist = watchlistRaw.filter(
    (w) => w.action !== "DEMOTED" && w.action !== "DROPPED",
  );

  const {
    cash,
    limits,
    sentimentThresholds,
    earningsRiskThresholds,
    trackedTickers,
    ruleVersionId,
    degraded,
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
      const stop = decToNum(p.stopLoss);
      const stopDistancePct =
        cur !== null && stop !== null && cur > 0 ? (stop - cur) / cur : null;
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
        stopLoss: stop,
        stopDistancePct,
        theme: p.theme,
        averageDownsUsed: p.addsUsed ?? 0,
        earningsDate: earn.earningsDate,
        daysToEarnings: earn.daysToEarnings,
        earningsRisk: earn.earningsRisk,
        earningsStale: earn.earningsStale,
        riskLevel: p.riskLevel,
        conviction: p.conviction,
        marketCapBucket: p.marketCapBucket,
        analystRating: p.analystRating,
        entryZone: p.entryZone,
        addZone: p.addZone,
        nextAddTrigger: p.nextAddTrigger,
        analystTarget: decToNum(p.analystTarget),
        upsidePct:
          computeUpsidePct(cur, decToNum(p.analystTarget)) ??
          decToNum(p.upsidePct),
        lastPriceUpdate: iso(p.lastPriceUpdate),
        priceStatus: priceStatusFromUpdate(
          p.lastPriceUpdate,
          new Set(lastRun.prices?.failedTickers ?? []),
          p.ticker,
        ),
        ...pageNotesPreview(p.pageNotes),
      };
    });

  const sleeveExposure = {
    QUALITY_CORE: 0,
    MOMENTUM_CATALYST: 0,
    SPECULATIVE: 0,
    UNASSIGNED: 0,
  };
  if (exCspxNav > 0) {
    for (const p of positions) {
      if (p.ticker.toUpperCase() === "CSPX" || p.weightPct == null) continue;
      const key = p.sleeve ?? "UNASSIGNED";
      if (key in sleeveExposure) {
        sleeveExposure[key as keyof typeof sleeveExposure] += p.weightPct / 100;
      } else {
        sleeveExposure.UNASSIGNED += p.weightPct / 100;
      }
    }
  }

  return {
    routine,
    rulesVersion: rulesVersion(),
    branch,
    /// RuleVersion the routine is running under; 0 when resolution degraded to disk.
    ruleVersionId,
    /// True when the ruleset came from disk defaults instead of the DB — log it.
    degraded,
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
      sleeveExposure,
    },
    positions,
    watchlist: watchlist.map((w) =>
      serializeWatchlistRow(w, {
        earningsRiskThresholds,
        failedTickers: new Set(lastRun.prices?.failedTickers ?? []),
      }),
    ),
    trends: trends.map((t) => serializeTrendRow(t, trendDetail)),
    ideas: ideas.map((i) =>
      serializeIdeaRow(i, {
        failedTickers: new Set(lastRun.prices?.failedTickers ?? []),
      }),
    ),
    documents,
    limits,
    thresholds: {
      sentiment: sentimentThresholds,
      earningsRisk: earningsRiskThresholds,
    },
    trackedTickers,
    enums: listStockEnums(),
    /// Paper-only shadow ledger for this branch — never the real book, never executable.
    shadow,
    lastRun,
  };
}
