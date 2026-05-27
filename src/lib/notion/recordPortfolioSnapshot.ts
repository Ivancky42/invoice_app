import { prisma } from "@/lib/prisma";
import {
	computePortfolioTotals,
	parseHoldingSlices,
	snapshotDateGMT8,
	type HoldingSlice,
} from "@/lib/stocks/portfolioTotals";

/**
 * Upsert today's portfolio snapshot (GMT+8 date). Safe to call on every
 * Notion→Neon sync — reruns the same day update the row, not duplicate it.
 */
export async function recordPortfolioSnapshot(): Promise<{ ok: boolean }> {
	const [portfolio, trades] = await Promise.all([
		prisma.portfolio.findMany(),
		prisma.trade.findMany(),
	]);

	const totals = computePortfolioTotals(portfolio, trades);
	if (totals.totalValue <= 0) {
		return { ok: false };
	}

	const breakdownSum = totals.breakdown.reduce((s, slice) => s + slice.value, 0);
	if (Math.abs(breakdownSum - totals.totalValue) > 0.02) {
		console.warn(
			`[portfolioSnapshot] breakdown sum ${breakdownSum} != total ${totals.totalValue}`,
		);
	}

	const snapshotDate = snapshotDateGMT8();

	const prev = await prisma.portfolioSnapshot.findFirst({
		where: { snapshotDate: { lt: snapshotDate } },
		orderBy: { snapshotDate: "desc" },
	});

	let dailyReturnPct: number | null = null;
	if (prev) {
		const prevVal = Number(prev.totalValue);
		if (prevVal > 0) {
			dailyReturnPct = ((totals.totalValue - prevVal) / prevVal) * 100;
		}
	}

	const data = {
		totalValue: totals.totalValue,
		equitiesValue: totals.equitiesValue,
		cashValue: totals.cashValue,
		holdingsBreakdown: totals.breakdown as HoldingSlice[],
		unrealizedPnl: totals.hasPnl ? totals.unrealizedPnl : null,
		dailyReturnPct,
		recordedAt: new Date(),
	};

	await prisma.portfolioSnapshot.upsert({
		where: { snapshotDate },
		create: { snapshotDate, ...data },
		update: data,
	});

	return { ok: true };
}
