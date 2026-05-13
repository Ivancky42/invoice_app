import { prisma } from "@/lib/prisma";
import type {
  Portfolio,
  Watchlist,
  Trade,
  Trend,
  Idea,
  SyncStatus,
} from "@/generated/prisma/client";

export type PortfolioRow = Portfolio;
export type WatchlistRow = Watchlist;
export type TradeRow = Trade;
export type TrendRow = Trend;
export type IdeaRow = Idea;
export type SyncStatusRow = SyncStatus;

export async function getPortfolio(): Promise<PortfolioRow[]> {
  return prisma.portfolio.findMany({ orderBy: { ticker: "asc" } });
}

export async function getWatchlist(): Promise<WatchlistRow[]> {
  return prisma.watchlist.findMany({
    orderBy: [{ priority: "asc" }, { ticker: "asc" }],
  });
}

export async function getTrades(): Promise<TradeRow[]> {
  return prisma.trade.findMany({ orderBy: [{ date: "desc" }, { title: "asc" }] });
}

export async function getTrends(): Promise<TrendRow[]> {
  return prisma.trend.findMany({ orderBy: [{ signalScore: "desc" }, { trendName: "asc" }] });
}

export async function getIdeas(): Promise<IdeaRow[]> {
  return prisma.idea.findMany({ orderBy: { stockSector: "asc" } });
}

export async function getSyncStatus(source = "notion"): Promise<SyncStatusRow | null> {
  return prisma.syncStatus.findUnique({ where: { source } });
}

// Sync runs once a day (09:30 GMT+8 / 01:30 UTC); flag as stale once we are
// more than ~26 h past the last good run so a missed cron is loud.
const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;

export function isStale(status: SyncStatusRow | null): boolean {
  if (!status?.lastSuccessAt) return true;
  return Date.now() - status.lastSuccessAt.getTime() > STALE_THRESHOLD_MS;
}
