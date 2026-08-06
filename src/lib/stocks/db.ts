import { prisma } from "@/lib/prisma";
import { parseHoldingSlices, type HoldingSlice } from "@/lib/stocks/portfolioTotals";
import type {
	Portfolio,
	Watchlist,
	Trade,
	Trend,
	Idea,
	DailyLog,
	StockReport,
	SyncStatus,
	DecisionReview,
	ContentPage,
} from "@/generated/prisma/client";
import { ContentPageKey, StockReportType } from "@/generated/prisma/client";
import type { ReportBlock } from "@/lib/content/blocks";
import { asReportBlocks } from "@/lib/content/blocks";
import {
	decToNum,
	parseDcaZoneUpper,
	priceInDcaZone,
} from "@/lib/stocks/format";

export type PortfolioRow = Portfolio;
/** Portfolio row with DCA / entry-zone flags for the UI. */
export type PortfolioWithDca = PortfolioRow & {
	inDcaZone: boolean;
	dcaZoneUpper: number | null;
};
export type WatchlistRow = Watchlist;
export type TradeRow = Trade;
export type TrendRow = Trend;
export type IdeaRow = Idea;
export type DailyLogRow = DailyLog;
export type StockReportRow = StockReport;
export type SyncStatusRow = SyncStatus;
export type DecisionReviewRow = DecisionReview;
export type ContentPageRow = ContentPage;

/** Plain shape for passing daily logs into client components (JSON-serializable). */
export type DailyLogDTO = {
	id: string;
	notionId: string | null;
	title: string;
	logDate: string | null;
	actionTaken: ReportBlock[] | null;
	alertEmailSent: boolean | null;
	flaggedTickers: string[];
	marketContext: ReportBlock[] | null;
	notes: ReportBlock[] | null;
	portfolioMove: ReportBlock[] | null;
	topNews: ReportBlock[] | null;
	watchlistMove: ReportBlock[] | null;
	rulesVersion: string | null;
};

function jsonBlocksOrNull(value: unknown): ReportBlock[] | null {
	const blocks = asReportBlocks(value);
	return blocks.length > 0 ? blocks : null;
}

export function dailyLogToDTO(row: DailyLogRow): DailyLogDTO {
	return {
		id: row.id,
		notionId: row.notionId,
		title: row.title,
		logDate: row.logDate ? row.logDate.toISOString() : null,
		actionTaken: jsonBlocksOrNull(row.actionTaken),
		alertEmailSent: row.alertEmailSent,
		flaggedTickers: row.flaggedTickers ?? [],
		marketContext: jsonBlocksOrNull(row.marketContext),
		notes: jsonBlocksOrNull(row.notes),
		portfolioMove: jsonBlocksOrNull(row.portfolioMove),
		topNews: jsonBlocksOrNull(row.topNews),
		watchlistMove: jsonBlocksOrNull(row.watchlistMove),
		rulesVersion: row.rulesVersion ?? null,
	};
}

/** Plain shape for passing stock reports into client components (JSON-serializable). */
export type StockReportDTO = {
	id: string;
	notionId: string | null;
	title: string;
	reportType: "WEEKLY" | "MONTHLY";
	reportDate: string | null;
	content: ReportBlock[];
};

export function stockReportToDTO(row: StockReportRow): StockReportDTO {
	return {
		id: row.id,
		notionId: row.notionId,
		title: row.title,
		reportType: row.reportType,
		reportDate: row.reportDate ? row.reportDate.toISOString() : null,
		content: asReportBlocks(row.content),
	};
}

/** All synced portfolio rows. Action (e.g. EXIT) is a signal only — not used to hide holdings. */
export async function getPortfolio(): Promise<PortfolioWithDca[]> {
	const rows = await prisma.portfolio.findMany({
		orderBy: [{ ticker: "asc" }],
	});

	const enriched: PortfolioWithDca[] = rows.map((p) => ({
		...p,
		dcaZoneUpper: parseDcaZoneUpper(p.entryZone),
		inDcaZone: priceInDcaZone(p.currentPrice, p.entryZone),
	}));

	function cmpUpside(
		a: (typeof rows)[0]["upsidePct"],
		b: (typeof rows)[0]["upsidePct"],
	): number {
		const na = decToNum(a ?? null);
		const nb = decToNum(b ?? null);
		if (na === null && nb === null) return 0;
		if (na === null) return 1;
		if (nb === null) return -1;
		return nb - na;
	}

	enriched.sort((a, b) => {
		if (a.inDcaZone !== b.inDcaZone) return a.inDcaZone ? -1 : 1;
		const u = cmpUpside(a.upsidePct, b.upsidePct);
		if (u !== 0) return u;
		return a.ticker.localeCompare(b.ticker);
	});

	return enriched;
}

export async function getWatchlist(): Promise<WatchlistRow[]> {
	return prisma.watchlist.findMany({
		orderBy: [{ priority: "asc" }, { ticker: "asc" }],
	});
}

export async function getTrades(): Promise<TradeRow[]> {
	return prisma.trade.findMany({
		orderBy: [{ date: "desc" }, { title: "asc" }],
	});
}

export async function getTrends(): Promise<TrendRow[]> {
	return prisma.trend.findMany({
		orderBy: [{ signalScore: "desc" }, { trendName: "asc" }],
	});
}

export async function getIdeas(): Promise<IdeaRow[]> {
	return prisma.idea.findMany({ orderBy: { stockSector: "asc" } });
}

export async function getDailyLogs(): Promise<DailyLogRow[]> {
	return prisma.dailyLog.findMany({
		orderBy: [
			{ logDate: { sort: "desc", nulls: "last" } },
			{ syncedAt: "desc" },
			{ title: "desc" },
		],
	});
}

export async function getLatestDailyLog(): Promise<DailyLogRow | null> {
	const row = await prisma.dailyLog.findFirst({
		orderBy: [
			{ logDate: { sort: "desc", nulls: "last" } },
			{ syncedAt: "desc" },
			{ title: "desc" },
		],
	});
	return row;
}

export async function getStockReports(type?: StockReportType): Promise<StockReportRow[]> {
	return prisma.stockReport.findMany({
		where: type ? { reportType: type } : undefined,
		orderBy: [
			{ reportDate: { sort: "desc", nulls: "last" } },
			{ syncedAt: "desc" },
			{ title: "desc" },
		],
	});
}

export async function getDecisionReviews(): Promise<DecisionReviewRow[]> {
	return prisma.decisionReview.findMany({
		orderBy: [
			{ decisionDate: { sort: "desc", nulls: "last" } },
			{ createdAt: "desc" },
		],
	});
}

/** Plain shape for Client Components (Prisma Decimal is not RSC-serializable). */
export type DecisionReviewDTO = {
	id: string;
	title: string;
	ticker: string | null;
	decisionDate: string | null;
	decisionType: DecisionReview["decisionType"];
	positionContext: DecisionReview["positionContext"];
	priceAtDecision: number | null;
	entryZone: string | null;
	stopLoss: number | null;
	target: number | null;
	convictionScore: number | null;
	catalyst: string | null;
	catalystDate: string | null;
	originalThesis: string | null;
	expectedOutcome: string | null;
	keyMetricToWatch: string | null;
	reasonForDecision: string | null;
	riskInvalidation: string | null;
	sourceSignal: string[];
	antiPatternTags: string[];
	criteriaThatWorked: string[];
	criteriaThatFailed: string[];
	reviewStatus: DecisionReview["reviewStatus"];
	outcome1w: string | null;
	outcome4w: string | null;
	outcome3m: string | null;
	return1wPct: number | null;
	return4wPct: number | null;
	return3mPct: number | null;
	finalVerdict: DecisionReview["finalVerdict"];
	signalQuality: DecisionReview["signalQuality"];
	executionQuality: DecisionReview["executionQuality"];
	lessonLearned: string | null;
};

function dateToIso(d: Date | null | undefined): string | null {
	return d ? d.toISOString() : null;
}

export function decisionReviewToDTO(row: DecisionReviewRow): DecisionReviewDTO {
	return {
		id: row.id,
		title: row.title,
		ticker: row.ticker,
		decisionDate: dateToIso(row.decisionDate),
		decisionType: row.decisionType,
		positionContext: row.positionContext,
		priceAtDecision: decToNum(row.priceAtDecision),
		entryZone: row.entryZone,
		stopLoss: decToNum(row.stopLoss),
		target: decToNum(row.target),
		convictionScore: row.convictionScore,
		catalyst: row.catalyst,
		catalystDate: dateToIso(row.catalystDate),
		originalThesis: row.originalThesis,
		expectedOutcome: row.expectedOutcome,
		keyMetricToWatch: row.keyMetricToWatch,
		reasonForDecision: row.reasonForDecision,
		riskInvalidation: row.riskInvalidation,
		sourceSignal: row.sourceSignal,
		antiPatternTags: row.antiPatternTags,
		criteriaThatWorked: row.criteriaThatWorked,
		criteriaThatFailed: row.criteriaThatFailed,
		reviewStatus: row.reviewStatus,
		outcome1w: row.outcome1w,
		outcome4w: row.outcome4w,
		outcome3m: row.outcome3m,
		return1wPct: decToNum(row.return1wPct),
		return4wPct: decToNum(row.return4wPct),
		return3mPct: decToNum(row.return3mPct),
		finalVerdict: row.finalVerdict,
		signalQuality: row.signalQuality,
		executionQuality: row.executionQuality,
		lessonLearned: row.lessonLearned,
	};
}

export async function getContentPages(): Promise<ContentPageRow[]> {
	const { ensureContentPages } = await import("@/lib/agent/contentPages");
	await ensureContentPages();
	return prisma.contentPage.findMany({ orderBy: { key: "asc" } });
}

export async function getContentPage(
	key: ContentPageKey,
): Promise<ContentPageRow | null> {
	const { ensureContentPages } = await import("@/lib/agent/contentPages");
	await ensureContentPages();
	return prisma.contentPage.findUnique({ where: { key } });
}

export type ContentPageDTO = {
	key: ContentPageKey;
	title: string;
	body: ReportBlock[];
	updatedAt: string | null;
	syncedAt: string | null;
};

export function contentPageToDTO(row: ContentPageRow): ContentPageDTO {
	return {
		key: row.key,
		title: row.title,
		body: asReportBlocks(row.body),
		updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
		syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
	};
}

export async function getLatestStockReport(
	type: StockReportType,
): Promise<StockReportRow | null> {
	return prisma.stockReport.findFirst({
		where: { reportType: type },
		orderBy: [
			{ reportDate: { sort: "desc", nulls: "last" } },
			{ syncedAt: "desc" },
			{ title: "desc" },
		],
	});
}

export type PortfolioSnapshotPoint = {
	snapshotDate: string;
	totalValue: number;
	equitiesValue: number | null;
	cashValue: number | null;
	holdings: HoldingSlice[];
	unrealizedPnl: number | null;
	dailyReturnPct: number | null;
};

export async function getPortfolioSnapshots(limit = 400): Promise<PortfolioSnapshotPoint[]> {
	const rows = await prisma.portfolioSnapshot.findMany({
		orderBy: { snapshotDate: "desc" },
		take: limit,
	});
	return rows.reverse().map((r) => ({
		snapshotDate: r.snapshotDate.toISOString(),
		totalValue: Number(r.totalValue),
		equitiesValue: r.equitiesValue !== null ? Number(r.equitiesValue) : null,
		cashValue: r.cashValue !== null ? Number(r.cashValue) : null,
		holdings: parseHoldingSlices(r.holdingsBreakdown),
		unrealizedPnl: r.unrealizedPnl !== null ? Number(r.unrealizedPnl) : null,
		dailyReturnPct: r.dailyReturnPct !== null ? Number(r.dailyReturnPct) : null,
	}));
}

export async function getSyncStatus(
	source = "prices",
): Promise<SyncStatusRow | null> {
	return prisma.syncStatus.findUnique({ where: { source } });
}

// Phase 5: banner tracks price sync (Finnhub/EODHD → Neon, 22:00 UTC = 06:00 GMT+8).
// Notion sync is frozen unless NOTION_SYNC_ENABLED=true.
// Flag stale if last success is older than ~26h so a missed daily run is visible.
const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;

export function isStale(status: SyncStatusRow | null): boolean {
	if (!status?.lastSuccessAt) return true;
	return Date.now() - status.lastSuccessAt.getTime() > STALE_THRESHOLD_MS;
}
