import { Prisma, type Prisma as PrismaTypes } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CONFIG_KEYS,
  getLimits,
  setConfig,
  type LimitsConfig,
} from "@/lib/stocks/config";
import {
  DEFAULT_EARNINGS_RISK,
  DEFAULT_SENTIMENT,
} from "@/lib/stocks/derived";
import { isCashTicker } from "@/lib/stocks/format";
import { snapshotDateGMT8 } from "@/lib/stocks/portfolioTotals";
import {
  serializeContentPage,
  serializeDecisionReviewRow,
  serializeIdeaRow,
  serializePortfolioRow,
  serializeTrendRow,
  serializeWatchlistRow,
} from "@/lib/agent/context";
import type {
  appendPageNotesInputSchema,
  dailyLogInputSchema,
  listDecisionReviewsQuerySchema,
  patchConfigInputSchema,
  patchPortfolioInputSchema,
  stockReportInputSchema,
  upsertContentPageInputSchema,
  upsertDecisionReviewInputSchema,
  upsertIdeaInputSchema,
  upsertTrendInputSchema,
  upsertWatchlistInputSchema,
} from "@/lib/agent/schemas";
import type { z } from "zod";
import { asReportBlocks } from "@/lib/content/blocks";
import type { WatchlistAction } from "@/generated/prisma/client";

type DailyLogInput = z.infer<typeof dailyLogInputSchema>;
type StockReportInput = z.infer<typeof stockReportInputSchema>;
type PatchPortfolioInput = z.infer<typeof patchPortfolioInputSchema>;
type UpsertWatchlistInput = z.infer<typeof upsertWatchlistInputSchema>;
type UpsertTrendInput = z.infer<typeof upsertTrendInputSchema>;
type UpsertIdeaInput = z.infer<typeof upsertIdeaInputSchema>;
type PatchConfigInput = z.infer<typeof patchConfigInputSchema>;
type AppendPageNotesInput = z.infer<typeof appendPageNotesInputSchema>;
type UpsertDecisionReviewInput = z.infer<typeof upsertDecisionReviewInputSchema>;
type ListDecisionReviewsQuery = z.infer<typeof listDecisionReviewsQuerySchema>;
type UpsertContentPageInput = z.infer<typeof upsertContentPageInputSchema>;

function parseYmdNoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00.000Z`);
}

/** Calendar days until earnings (GMT+8); past dates → null (stale until re-confirmed). */
function daysToEarningsFrom(date: Date | null): number | null {
  if (!date) return null;
  const today = snapshotDateGMT8();
  const earnDay = snapshotDateGMT8(date);
  const days = Math.round((earnDay.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return null;
  return days;
}

/**
 * Rebuild TRACKED_TICKERS from Portfolio + active Watchlist rows.
 * Soft-demoted (DEMOTED/DROPPED) watchlist names are excluded.
 */
export async function syncTrackedTickersFromDb() {
  const [portfolio, watchlist] = await Promise.all([
    prisma.portfolio.findMany({ select: { ticker: true } }),
    prisma.watchlist.findMany({
      where: { NOT: { action: { in: ["DEMOTED", "DROPPED"] } } },
      select: { ticker: true },
    }),
  ]);
  const portfolioTickers = [
    ...new Set(
      portfolio
        .map((p) => p.ticker.trim().toUpperCase())
        .filter((t) => t && !isCashTicker(t)),
    ),
  ].sort();
  const watchlistTickers = [
    ...new Set(watchlist.map((w) => w.ticker.trim().toUpperCase()).filter(Boolean)),
  ].sort();
  await setConfig(CONFIG_KEYS.TRACKED_TICKERS, {
    portfolio: portfolioTickers,
    watchlist: watchlistTickers,
  });
  return {
    ok: true as const,
    TRACKED_TICKERS: { portfolio: portfolioTickers, watchlist: watchlistTickers },
  };
}

/** undefined = omit; null = JSON null; else value. */
function jsonField(
  value: unknown,
): PrismaTypes.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as PrismaTypes.InputJsonValue;
}

function assignDefined<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
  skip: string[] = [],
): void {
  for (const [k, v] of Object.entries(source)) {
    if (skip.includes(k)) continue;
    if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  }
}

export async function upsertDailyLog(input: DailyLogInput) {
  const logDate = parseYmdNoon(input.logDate);
  const title = input.title?.trim() || input.logDate;

  const update: PrismaTypes.DailyLogUpdateInput = {};
  assignDefined(update as Record<string, unknown>, {
    title,
    logDate,
    marketContext: jsonField(input.marketContext),
    topNews: jsonField(input.topNews),
    portfolioMove: jsonField(input.portfolioMove),
    watchlistMove: jsonField(input.watchlistMove),
    actionTaken: jsonField(input.actionTaken),
    notes: jsonField(input.notes),
    flaggedTickers: input.flaggedTickers,
    alertEmailSent: input.alertEmailSent,
    rulesVersion: input.rulesVersion,
  });

  const row = await prisma.dailyLog.upsert({
    where: { logDate },
    create: {
      title,
      logDate,
      marketContext: jsonField(input.marketContext) as PrismaTypes.InputJsonValue,
      topNews: jsonField(input.topNews) as PrismaTypes.InputJsonValue,
      portfolioMove: jsonField(input.portfolioMove) as PrismaTypes.InputJsonValue,
      watchlistMove: jsonField(input.watchlistMove) as PrismaTypes.InputJsonValue,
      actionTaken: jsonField(input.actionTaken) as PrismaTypes.InputJsonValue,
      notes: jsonField(input.notes) as PrismaTypes.InputJsonValue,
      flaggedTickers: input.flaggedTickers ?? [],
      alertEmailSent: input.alertEmailSent ?? false,
      rulesVersion: input.rulesVersion ?? null,
    },
    update,
  });

  return {
    id: row.id,
    title: row.title,
    logDate: row.logDate?.toISOString() ?? null,
    flaggedTickers: row.flaggedTickers,
    rulesVersion: row.rulesVersion,
  };
}

export async function upsertStockReport(input: StockReportInput) {
  const reportDate = parseYmdNoon(input.reportDate);
  const title = input.title?.trim() || `${input.reportType} ${input.reportDate}`;

  const row = await prisma.stockReport.upsert({
    where: {
      reportType_reportDate: {
        reportType: input.reportType,
        reportDate,
      },
    },
    create: {
      title,
      reportType: input.reportType,
      reportDate,
      content: input.content as PrismaTypes.InputJsonValue,
      rulesVersion: input.rulesVersion ?? null,
    },
    update: {
      title,
      content: input.content as PrismaTypes.InputJsonValue,
      rulesVersion: input.rulesVersion ?? null,
    },
  });

  return {
    id: row.id,
    title: row.title,
    reportType: row.reportType,
    reportDate: row.reportDate?.toISOString() ?? null,
    rulesVersion: row.rulesVersion,
  };
}

export async function patchPortfolio(tickerRaw: string, input: PatchPortfolioInput) {
  const ticker = tickerRaw.trim().toUpperCase();
  const existing = await prisma.portfolio.findFirst({
    where: { ticker: { equals: ticker, mode: "insensitive" } },
  });
  if (!existing) {
    return {
      ok: false as const,
      status: 404 as const,
      reason: "portfolio_not_found",
      ticker,
    };
  }

  const data: PrismaTypes.PortfolioUpdateInput = {};
  if (input.action !== undefined) data.action = input.action;
  if (input.stopLoss !== undefined) data.stopLoss = input.stopLoss;
  if (input.sleeve !== undefined) data.sleeve = input.sleeve;
  if (input.conviction !== undefined) data.conviction = input.conviction;
  if (input.thesis !== undefined) data.thesis = jsonField(input.thesis);
  if (input.pageNotes !== undefined) data.pageNotes = jsonField(input.pageNotes);
  if (input.notes !== undefined) data.notes = jsonField(input.notes);
  if (input.entryZone !== undefined) data.entryZone = input.entryZone;
  if (input.addZone !== undefined) data.addZone = input.addZone;
  if (input.nextAddTrigger !== undefined) data.nextAddTrigger = input.nextAddTrigger;
  if (input.keyRisk !== undefined) data.keyRisk = input.keyRisk;
  if (input.theme !== undefined) data.theme = input.theme;
  if (input.riskLevel !== undefined) data.riskLevel = input.riskLevel;
  if (input.marketCapBucket !== undefined) data.marketCapBucket = input.marketCapBucket;
  if (input.analystRating !== undefined) data.analystRating = input.analystRating;
  if (input.earningsDate !== undefined) {
    if (input.earningsDate === null) {
      data.earningsDate = null;
      data.daysToEarnings = null;
    } else {
      const d = parseYmdNoon(input.earningsDate);
      data.earningsDate = d;
      data.daysToEarnings = daysToEarningsFrom(d);
    }
  }

  if (Object.keys(data).length === 0) {
    return { ok: false as const, status: 400 as const, reason: "empty_patch", ticker };
  }

  const row = await prisma.portfolio.update({
    where: { id: existing.id },
    data,
  });
  return { ok: true as const, position: serializePortfolioRow(row) };
}

export async function upsertWatchlist(input: UpsertWatchlistInput) {
  const ticker = input.ticker.trim().toUpperCase();
  const action = input.action;
  const clearDemotion =
    action !== undefined &&
    action !== null &&
    action !== "DEMOTED" &&
    action !== "DROPPED";

  const create: PrismaTypes.WatchlistUncheckedCreateInput = {
    ticker,
    company: input.company ?? undefined,
    theme: input.theme ?? undefined,
    priority: input.priority ?? undefined,
    action: action ?? undefined,
    demotedAt:
      action === "DEMOTED" || action === "DROPPED"
        ? new Date()
        : clearDemotion
          ? null
          : undefined,
    riskLevel: input.riskLevel ?? undefined,
    analystRating: input.analystRating ?? undefined,
    marketCapBucket: input.marketCapBucket ?? undefined,
    entryZone: input.entryZone ?? undefined,
    stopLoss: input.stopLoss ?? undefined,
    keyCatalyst: input.keyCatalyst ?? undefined,
    keyRisk: input.keyRisk ?? undefined,
    thesis: jsonField(input.thesis) as PrismaTypes.InputJsonValue | undefined,
    actionNotes: jsonField(input.actionNotes) as PrismaTypes.InputJsonValue | undefined,
    pageNotes: jsonField(input.pageNotes) as PrismaTypes.InputJsonValue | undefined,
  };

  if (input.earningsDate !== undefined) {
    if (input.earningsDate === null) {
      create.earningsDate = null;
      create.daysToEarnings = null;
    } else {
      const d = parseYmdNoon(input.earningsDate);
      create.earningsDate = d;
      create.daysToEarnings = daysToEarningsFrom(d);
    }
  }

  const update: PrismaTypes.WatchlistUpdateInput = {};
  assignDefined(update as Record<string, unknown>, create as Record<string, unknown>, [
    "ticker",
  ]);
  if (action === null) {
    update.action = null;
    update.demotedAt = null;
  } else if (clearDemotion) {
    update.demotedAt = null;
  } else if (action === "DEMOTED" || action === "DROPPED") {
    update.demotedAt = new Date();
  }

  const row = await prisma.watchlist.upsert({
    where: { ticker },
    create,
    update,
  });
  await syncTrackedTickersFromDb();
  return serializeWatchlistRow(row);
}

/**
 * Soft-demote by default (Cowork §6). Pass `hard: true` to permanently delete.
 */
export async function deleteWatchlist(
  tickerRaw: string,
  opts?: { hard?: boolean; action?: Extract<WatchlistAction, "DEMOTED" | "DROPPED"> },
) {
  const ticker = tickerRaw.trim().toUpperCase();
  const existing = await prisma.watchlist.findFirst({
    where: { ticker: { equals: ticker, mode: "insensitive" } },
  });
  if (!existing) {
    return {
      ok: false as const,
      status: 404 as const,
      reason: "watchlist_not_found",
      ticker,
    };
  }
  if (opts?.hard) {
    await prisma.watchlist.delete({ where: { id: existing.id } });
    await syncTrackedTickersFromDb();
    return { ok: true as const, ticker, hardDeleted: true as const };
  }
  const action = opts?.action ?? "DEMOTED";
  const row = await prisma.watchlist.update({
    where: { id: existing.id },
    data: { action, demotedAt: new Date() },
  });
  await syncTrackedTickersFromDb();
  return {
    ok: true as const,
    ticker,
    hardDeleted: false as const,
    watchlist: serializeWatchlistRow(row),
  };
}

export async function appendPageNotes(input: AppendPageNotesInput) {
  const ticker = input.ticker.trim().toUpperCase();
  const incoming = asReportBlocks(input.blocks);
  if (incoming.length === 0) {
    return { ok: false as const, status: 400 as const, reason: "empty_blocks", ticker };
  }

  if (input.target === "portfolio") {
    const existing = await prisma.portfolio.findFirst({
      where: { ticker: { equals: ticker, mode: "insensitive" } },
    });
    if (!existing) {
      return {
        ok: false as const,
        status: 404 as const,
        reason: "portfolio_not_found",
        ticker,
      };
    }
    const merged = [...asReportBlocks(existing.pageNotes), ...incoming];
    const row = await prisma.portfolio.update({
      where: { id: existing.id },
      data: { pageNotes: merged as PrismaTypes.InputJsonValue },
    });
    return {
      ok: true as const,
      target: "portfolio" as const,
      ticker,
      pageNotes: asReportBlocks(row.pageNotes),
      appended: incoming.length,
      totalBlocks: merged.length,
    };
  }

  const existing = await prisma.watchlist.findFirst({
    where: { ticker: { equals: ticker, mode: "insensitive" } },
  });
  if (!existing) {
    return {
      ok: false as const,
      status: 404 as const,
      reason: "watchlist_not_found",
      ticker,
    };
  }
  const merged = [...asReportBlocks(existing.pageNotes), ...incoming];
  const row = await prisma.watchlist.update({
    where: { id: existing.id },
    data: { pageNotes: merged as PrismaTypes.InputJsonValue },
  });
  return {
    ok: true as const,
    target: "watchlist" as const,
    ticker,
    pageNotes: asReportBlocks(row.pageNotes),
    appended: incoming.length,
    totalBlocks: merged.length,
  };
}

export async function upsertDecisionReview(input: UpsertDecisionReviewInput) {
  const ticker = input.ticker?.trim().toUpperCase() || null;
  const decisionDate =
    input.decisionDate === undefined
      ? undefined
      : input.decisionDate === null
        ? null
        : parseYmdNoon(input.decisionDate);
  const catalystDate =
    input.catalystDate === undefined
      ? undefined
      : input.catalystDate === null
        ? null
        : parseYmdNoon(input.catalystDate);

  const data: PrismaTypes.DecisionReviewUncheckedCreateInput = {
    title: input.title.trim(),
    ticker,
    decisionDate: decisionDate ?? undefined,
    decisionType: input.decisionType ?? undefined,
    positionContext: input.positionContext ?? undefined,
    priceAtDecision: input.priceAtDecision ?? undefined,
    entryZone: input.entryZone ?? undefined,
    stopLoss: input.stopLoss ?? undefined,
    target: input.target ?? undefined,
    convictionScore: input.convictionScore ?? undefined,
    catalyst: input.catalyst ?? undefined,
    catalystDate: catalystDate ?? undefined,
    originalThesis: input.originalThesis ?? undefined,
    expectedOutcome: input.expectedOutcome ?? undefined,
    keyMetricToWatch: input.keyMetricToWatch ?? undefined,
    reasonForDecision: input.reasonForDecision ?? undefined,
    riskInvalidation: input.riskInvalidation ?? undefined,
    sourceSignal: input.sourceSignal ?? undefined,
    antiPatternTags: input.antiPatternTags ?? undefined,
    criteriaThatWorked: input.criteriaThatWorked ?? undefined,
    criteriaThatFailed: input.criteriaThatFailed ?? undefined,
    reviewStatus: input.reviewStatus ?? "PENDING",
    outcome1w: input.outcome1w ?? undefined,
    outcome4w: input.outcome4w ?? undefined,
    outcome3m: input.outcome3m ?? undefined,
    return1wPct: input.return1wPct ?? undefined,
    return4wPct: input.return4wPct ?? undefined,
    return3mPct: input.return3mPct ?? undefined,
    finalVerdict: input.finalVerdict ?? undefined,
    signalQuality: input.signalQuality ?? undefined,
    executionQuality: input.executionQuality ?? undefined,
    lessonLearned: input.lessonLearned ?? undefined,
    updateStrategy: input.updateStrategy ?? undefined,
    rulesVersion: input.rulesVersion ?? undefined,
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
  };

  if (input.idempotencyKey?.trim()) {
    const key = input.idempotencyKey.trim();
    const existing = await prisma.decisionReview.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) {
      const { idempotencyKey: _k, ...update } = data;
      const row = await prisma.decisionReview.update({
        where: { id: existing.id },
        data: update,
      });
      return { ok: true as const, idempotentReplay: true as const, decision: serializeDecisionReviewRow(row) };
    }
    const row = await prisma.decisionReview.create({ data });
    return { ok: true as const, idempotentReplay: false as const, decision: serializeDecisionReviewRow(row) };
  }

  const row = await prisma.decisionReview.create({ data });
  return { ok: true as const, idempotentReplay: false as const, decision: serializeDecisionReviewRow(row) };
}

export async function listDecisionReviews(query: ListDecisionReviewsQuery = {}) {
  const limit = query.limit ?? 50;
  const where: PrismaTypes.DecisionReviewWhereInput = {};
  if (query.ticker) {
    where.ticker = { equals: query.ticker.trim().toUpperCase(), mode: "insensitive" };
  }
  if (query.reviewStatus) {
    where.reviewStatus = query.reviewStatus;
  }
  if (query.pendingDueWithinDays != null) {
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - query.pendingDueWithinDays);
    where.reviewStatus = "PENDING";
    where.decisionDate = { gte: start, lte: now };
  }
  const rows = await prisma.decisionReview.findMany({
    where,
    orderBy: [{ decisionDate: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  return rows.map(serializeDecisionReviewRow);
}

export async function getContentPage(key: UpsertContentPageInput["key"]) {
  const row = await prisma.contentPage.findUnique({ where: { key } });
  if (!row) {
    return {
      ok: false as const,
      status: 404 as const,
      reason: "content_page_not_found",
      key,
    };
  }
  return { ok: true as const, document: serializeContentPage(row) };
}

export async function upsertContentPage(input: UpsertContentPageInput) {
  const title =
    input.title?.trim() ||
    (input.key === "STRATEGY_LESSONS" ? "Strategy Lessons Summary" : "Investment Style Profile");
  const row = await prisma.contentPage.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      title,
      body: input.body as PrismaTypes.InputJsonValue,
    },
    update: {
      title,
      body: input.body as PrismaTypes.InputJsonValue,
    },
  });
  return serializeContentPage(row);
}

export async function upsertTrend(input: UpsertTrendInput) {
  const trendName = input.trendName.trim();

  const dateDiscovered =
    input.dateDiscovered === undefined
      ? undefined
      : input.dateDiscovered === null
        ? null
        : parseYmdNoon(input.dateDiscovered);

  const create: PrismaTypes.TrendUncheckedCreateInput = {
    trendName,
    dateDiscovered,
    representativeTickers: input.representativeTickers ?? undefined,
    theme: input.theme ?? undefined,
    lifecycleStage: input.lifecycleStage ?? undefined,
    signalScore: input.signalScore ?? undefined,
    socialVelocity: input.socialVelocity ?? undefined,
    analystMomentum: input.analystMomentum ?? undefined,
    priceClustering: input.priceClustering ?? undefined,
    fundamentalBacking: input.fundamentalBacking ?? undefined,
    discoveredVia: input.discoveredVia ?? undefined,
    weekMomentum: input.weekMomentum ?? undefined,
    perf1m: input.perf1m ?? undefined,
    perf3m: input.perf3m ?? undefined,
    verdict: input.verdict ?? undefined,
    similarToPastTrend: input.similarToPastTrend ?? undefined,
    keyCatalyst: input.keyCatalyst ?? undefined,
    avoidReason: jsonField(input.avoidReason) as PrismaTypes.InputJsonValue | undefined,
    notes: jsonField(input.notes) as PrismaTypes.InputJsonValue | undefined,
    retrospective: jsonField(input.retrospective) as PrismaTypes.InputJsonValue | undefined,
  };

  const update: PrismaTypes.TrendUpdateInput = {};
  assignDefined(update as Record<string, unknown>, create as Record<string, unknown>, [
    "trendName",
  ]);

  const row = await prisma.trend.upsert({
    where: { trendName },
    create,
    update,
  });
  return serializeTrendRow(row, true);
}

export async function upsertIdea(input: UpsertIdeaInput) {
  const stockSector = input.stockSector?.trim();
  const leadTicker = input.leadTicker?.trim()?.toUpperCase() ?? null;

  let existing = stockSector
    ? await prisma.idea.findUnique({ where: { stockSector } })
    : null;
  if (!existing && leadTicker) {
    existing = await prisma.idea.findFirst({
      where: { leadTicker: { equals: leadTicker, mode: "insensitive" } },
    });
  }

  const dateField = (v: string | null | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return parseYmdNoon(v);
  };

  const fields: Record<string, unknown> = {
    leadTicker,
    company: input.company,
    theme: input.theme,
    riskLevel: input.riskLevel,
    status: input.status,
    ideaStage: input.ideaStage,
    socialBuzz: input.socialBuzz,
    foundVia: input.foundVia,
    whyInteresting: jsonField(input.whyInteresting),
    keyRisk: input.keyRisk,
    notes: jsonField(input.notes),
    catalystDate: dateField(input.catalystDate),
    dateFound: dateField(input.dateFound),
    lastReviewed: dateField(input.lastReviewed),
    graduationDate: dateField(input.graduationDate),
    graduationPrice: input.graduationPrice,
  };

  if (existing) {
    const update: PrismaTypes.IdeaUpdateInput = {};
    assignDefined(update as Record<string, unknown>, fields);
    if (stockSector && stockSector !== existing.stockSector) {
      update.stockSector = stockSector;
    }
    const row = await prisma.idea.update({ where: { id: existing.id }, data: update });
    return serializeIdeaRow(row);
  }

  const createKey = stockSector || leadTicker!;
  const row = await prisma.idea.create({
    data: {
      stockSector: createKey,
      leadTicker,
      company: input.company ?? null,
      theme: input.theme ?? null,
      riskLevel: input.riskLevel ?? null,
      status: input.status ?? null,
      ideaStage: input.ideaStage ?? null,
      socialBuzz: input.socialBuzz ?? null,
      foundVia: input.foundVia ?? null,
      whyInteresting: jsonField(input.whyInteresting) as PrismaTypes.InputJsonValue,
      keyRisk: input.keyRisk ?? null,
      notes: jsonField(input.notes) as PrismaTypes.InputJsonValue,
      catalystDate: dateField(input.catalystDate) ?? null,
      dateFound: dateField(input.dateFound) ?? null,
      lastReviewed: dateField(input.lastReviewed) ?? null,
      graduationDate: dateField(input.graduationDate) ?? null,
      graduationPrice: input.graduationPrice ?? null,
    },
  });
  return serializeIdeaRow(row);
}

function mergeLimits(
  current: LimitsConfig,
  patch: NonNullable<PatchConfigInput["LIMITS"]>,
): LimitsConfig {
  return {
    singlePositionPct: patch.singlePositionPct ?? current.singlePositionPct,
    themePct: patch.themePct ?? current.themePct,
    cashFloorPct: patch.cashFloorPct ?? current.cashFloorPct,
    maxAverageDowns: patch.maxAverageDowns ?? current.maxAverageDowns,
    tierBands: {
      TEST_STARTER: patch.tierBands?.TEST_STARTER ?? current.tierBands.TEST_STARTER,
      CONFIRMATION: patch.tierBands?.CONFIRMATION ?? current.tierBands.CONFIRMATION,
      CONVICTION: patch.tierBands?.CONVICTION ?? current.tierBands.CONVICTION,
    },
  };
}

/**
 * Patch safe Config keys (cash, FX, thresholds, tracked, LIMITS).
 * Never prompts. LIMITS patches are allowed but change hard caps — use sparingly.
 */
export async function patchConfig(input: PatchConfigInput) {
  const updated: string[] = [];

  if (input.CASH_POSITION_USD !== undefined) {
    await setConfig(CONFIG_KEYS.CASH_POSITION_USD, input.CASH_POSITION_USD);
    updated.push(CONFIG_KEYS.CASH_POSITION_USD);
    // Always sync CASH_USD portfolio row so UI/snapshots stay aligned with Config.
    const cashRow = await prisma.portfolio.findFirst({
      where: { ticker: { equals: "CASH_USD", mode: "insensitive" } },
    });
    if (cashRow && isCashTicker(cashRow.ticker)) {
      await prisma.portfolio.update({
        where: { id: cashRow.id },
        data: {
          currentPrice: input.CASH_POSITION_USD,
          myAvgCost: input.CASH_POSITION_USD,
          lastPriceUpdate: new Date(),
        },
      });
    } else {
      await prisma.portfolio.create({
        data: {
          ticker: "CASH_USD",
          currentPrice: input.CASH_POSITION_USD,
          myAvgCost: input.CASH_POSITION_USD,
          lastPriceUpdate: new Date(),
        },
      });
    }
  }
  if (input.CASH_POSITION_MYR !== undefined) {
    await setConfig(CONFIG_KEYS.CASH_POSITION_MYR, input.CASH_POSITION_MYR);
    updated.push(CONFIG_KEYS.CASH_POSITION_MYR);
  }
  if (input.FX_RATE_USD_MYR !== undefined) {
    await setConfig(CONFIG_KEYS.FX_RATE_USD_MYR, input.FX_RATE_USD_MYR);
    updated.push(CONFIG_KEYS.FX_RATE_USD_MYR);
  }
  if (input.CASH_LAST_UPDATED !== undefined) {
    await setConfig(
      CONFIG_KEYS.CASH_LAST_UPDATED,
      input.CASH_LAST_UPDATED ?? new Date().toISOString(),
    );
    updated.push(CONFIG_KEYS.CASH_LAST_UPDATED);
  }

  if (input.CASH_POSITION_USD !== undefined && input.CASH_POSITION_MYR === undefined) {
    const fxRow = await prisma.config.findUnique({
      where: { key: CONFIG_KEYS.FX_RATE_USD_MYR },
    });
    const fx =
      input.FX_RATE_USD_MYR ??
      (typeof fxRow?.value === "number" ? fxRow.value : 4.2);
    await setConfig(CONFIG_KEYS.CASH_POSITION_MYR, input.CASH_POSITION_USD * fx);
    if (!updated.includes(CONFIG_KEYS.CASH_POSITION_MYR)) {
      updated.push(CONFIG_KEYS.CASH_POSITION_MYR);
    }
    if (input.CASH_LAST_UPDATED === undefined) {
      await setConfig(CONFIG_KEYS.CASH_LAST_UPDATED, new Date().toISOString());
      if (!updated.includes(CONFIG_KEYS.CASH_LAST_UPDATED)) {
        updated.push(CONFIG_KEYS.CASH_LAST_UPDATED);
      }
    }
  }

  if (input.LIMITS !== undefined) {
    const current = await getLimits();
    await setConfig(CONFIG_KEYS.LIMITS, mergeLimits(current, input.LIMITS));
    updated.push(CONFIG_KEYS.LIMITS);
  }

  if (input.SENTIMENT_THRESHOLDS !== undefined) {
    const raw = await prisma.config.findUnique({
      where: { key: CONFIG_KEYS.SENTIMENT_THRESHOLDS },
    });
    const base =
      raw?.value && typeof raw.value === "object" && !Array.isArray(raw.value)
        ? (raw.value as Record<string, number>)
        : { ...DEFAULT_SENTIMENT };
    await setConfig(CONFIG_KEYS.SENTIMENT_THRESHOLDS, {
      ...base,
      ...input.SENTIMENT_THRESHOLDS,
    });
    updated.push(CONFIG_KEYS.SENTIMENT_THRESHOLDS);
  }

  if (input.EARNINGS_RISK_THRESHOLDS !== undefined) {
    const raw = await prisma.config.findUnique({
      where: { key: CONFIG_KEYS.EARNINGS_RISK_THRESHOLDS },
    });
    const base =
      raw?.value && typeof raw.value === "object" && !Array.isArray(raw.value)
        ? (raw.value as Record<string, number>)
        : { ...DEFAULT_EARNINGS_RISK };
    await setConfig(CONFIG_KEYS.EARNINGS_RISK_THRESHOLDS, {
      ...base,
      ...input.EARNINGS_RISK_THRESHOLDS,
    });
    updated.push(CONFIG_KEYS.EARNINGS_RISK_THRESHOLDS);
  }

  if (input.TRACKED_TICKERS !== undefined) {
    const raw = await prisma.config.findUnique({
      where: { key: CONFIG_KEYS.TRACKED_TICKERS },
    });
    const prev =
      raw?.value && typeof raw.value === "object" && !Array.isArray(raw.value)
        ? (raw.value as { portfolio?: string[]; watchlist?: string[] })
        : {};
    await setConfig(CONFIG_KEYS.TRACKED_TICKERS, {
      portfolio: input.TRACKED_TICKERS.portfolio ?? prev.portfolio ?? [],
      watchlist: input.TRACKED_TICKERS.watchlist ?? prev.watchlist ?? [],
    });
    updated.push(CONFIG_KEYS.TRACKED_TICKERS);
  }

  return { ok: true as const, updated };
}
