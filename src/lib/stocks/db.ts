import { prisma } from "@/lib/prisma";
import type {
	Portfolio,
	Watchlist,
	Trade,
	Trend,
	Idea,
	SyncStatus,
} from "@/generated/prisma/client";
import { decToNum, parseDcaZoneUpper, priceInDcaZone } from "@/lib/stocks/format";

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
export type SyncStatusRow = SyncStatus;

/** Active positions only: hide archived rows whose action contains `exit` (case-insensitive). */
export async function getPortfolio(): Promise<PortfolioWithDca[]> {
	const rows = await prisma.portfolio.findMany({
		where: {
			OR: [
				{ action: null },
				{
					NOT: {
						action: { contains: "EXIT", mode: "insensitive" },
					},
				},
			],
		},
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

export async function getSyncStatus(
	source = "notion",
): Promise<SyncStatusRow | null> {
	return prisma.syncStatus.findUnique({ where: { source } });
}

// Sync runs once a day (09:30 GMT+8 / 01:30 UTC); flag as stale once we are
// more than ~26 h past the last good run so a missed cron is loud.
const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;

export function isStale(status: SyncStatusRow | null): boolean {
	if (!status?.lastSuccessAt) return true;
	return Date.now() - status.lastSuccessAt.getTime() > STALE_THRESHOLD_MS;
}
