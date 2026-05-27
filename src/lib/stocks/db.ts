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
} from "@/generated/prisma/client";
import { StockReportType } from "@/generated/prisma/client";
import type { ReportBlock } from "@/lib/notion/blocks";
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

/** Plain shape for passing daily logs into client components (JSON-serializable). */
export type DailyLogDTO = {
	notionId: string;
	title: string;
	logDate: string | null;
	actionTaken: string | null;
	alertEmailSent: boolean | null;
	flaggedTickers: string | null;
	flagsCount: number | null;
	marketContext: string | null;
	notes: string | null;
	portfolioMove: string | null;
	topNews: string | null;
	watchlistMove: string | null;
};

export function dailyLogToDTO(row: DailyLogRow): DailyLogDTO {
	return {
		notionId: row.notionId,
		title: row.title,
		logDate: row.logDate ? row.logDate.toISOString() : null,
		actionTaken: row.actionTaken,
		alertEmailSent: row.alertEmailSent,
		flaggedTickers: row.flaggedTickers,
		flagsCount: row.flagsCount,
		marketContext: row.marketContext,
		notes: row.notes,
		portfolioMove: row.portfolioMove,
		topNews: row.topNews,
		watchlistMove: row.watchlistMove,
	};
}

/** Plain shape for passing stock reports into client components (JSON-serializable). */
export type StockReportDTO = {
	notionId: string;
	title: string;
	reportType: "WEEKLY" | "MONTHLY";
	reportDate: string | null;
	content: ReportBlock[];
};

export function stockReportToDTO(row: StockReportRow): StockReportDTO {
	return {
		notionId: row.notionId,
		title: row.title,
		reportType: row.reportType,
		reportDate: row.reportDate ? row.reportDate.toISOString() : null,
		content: row.content as ReportBlock[],
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
	source = "notion",
): Promise<SyncStatusRow | null> {
	return prisma.syncStatus.findUnique({ where: { source } });
}

// Sync: daily Finnhub→Notion 22:00 UTC (= 06:00 GMT+8); Notion→Neon 01:30 UTC (= 09:30 GMT+8).
// Flag stale if last success is older than ~26h so a missed daily run is visible.
const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;

export function isStale(status: SyncStatusRow | null): boolean {
	if (!status?.lastSuccessAt) return true;
	return Date.now() - status.lastSuccessAt.getTime() > STALE_THRESHOLD_MS;
}
