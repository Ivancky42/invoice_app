import type { Portfolio, Trade } from "@/generated/prisma/client";
import {
	decToNum,
	holdingsByTicker,
	isCashTicker,
	notionCashBalanceUsd,
	positionPnl,
} from "@/lib/stocks/format";

export type HoldingSlice = {
	/** Stable id for stacking (`CASH_USD`, `DDOG`, …). */
	key: string;
	label: string;
	value: number;
	isCash: boolean;
};

export type PortfolioTotals = {
	totalValue: number;
	equitiesValue: number;
	cashValue: number;
	unrealizedPnl: number;
	hasPnl: boolean;
	breakdown: HoldingSlice[];
};

function normalizedHoldings(trades: Trade[]): Map<string, number> {
	const raw = holdingsByTicker(trades);
	const map = new Map<string, number>();
	for (const [ticker, shares] of raw) {
		map.set(ticker.trim().toUpperCase(), shares);
	}
	return map;
}

function sharesHeld(ticker: string, holdings: Map<string, number>): number | null {
	const key = ticker.trim().toUpperCase();
	const shares = holdings.get(key);
	return shares !== undefined && shares !== 0 ? shares : null;
}

/**
 * Prefer Portfolio.shares (book of record) when the column is set — including 0 (flat).
 * Fall back to trade-log net only when shares is null/unset.
 */
export function resolvePositionShares(
	p: Portfolio,
	holdings: Map<string, number>,
): number | null {
	const stored = decToNum(p.shares);
	if (stored !== null) return stored;
	return sharesHeld(p.ticker, holdings);
}

/**
 * Per-holding mark-to-market values (same rules as stocks overview donuts).
 *
 * - **CASH_USD**: balance from Notion `Current Price` / `My Avg Cost`.
 * - **Equities** (incl. CSPX): Portfolio.shares (preferred) or trade-log × synced `Current Price`.
 */
export function computePortfolioBreakdown(
	portfolio: Portfolio[],
	trades: Trade[],
): HoldingSlice[] {
	const holdings = normalizedHoldings(trades);
	const slices: HoldingSlice[] = [];

	for (const p of portfolio) {
		if (isCashTicker(p.ticker)) {
			const bal = notionCashBalanceUsd(p.currentPrice, p.myAvgCost);
			if (bal > 0) {
				slices.push({
					key: "CASH_USD",
					label: "Cash",
					value: bal,
					isCash: true,
				});
			}
			continue;
		}

		const cur = decToNum(p.currentPrice);
		const cost = decToNum(p.myAvgCost);
		const shares = resolvePositionShares(p, holdings);
		const r = positionPnl(cur, cost, shares);

		if (r.marketValue !== null && r.marketValue > 0) {
			slices.push({
				key: p.ticker.trim().toUpperCase(),
				label: p.ticker,
				value: r.marketValue,
				isCash: false,
			});
		}
	}

	return slices.sort((a, b) => b.value - a.value);
}

/** Mark-to-market portfolio totals derived from {@link computePortfolioBreakdown}. */
export function computePortfolioTotals(
	portfolio: Portfolio[],
	trades: Trade[],
): PortfolioTotals {
	const breakdown = computePortfolioBreakdown(portfolio, trades);
	const holdings = normalizedHoldings(trades);

	let unrealizedPnl = 0;
	let hasPnl = false;

	for (const p of portfolio) {
		if (isCashTicker(p.ticker)) continue;
		const cur = decToNum(p.currentPrice);
		const cost = decToNum(p.myAvgCost);
		const shares = resolvePositionShares(p, holdings);
		const r = positionPnl(cur, cost, shares);
		if (r.dollar !== null) {
			unrealizedPnl += r.dollar;
			hasPnl = true;
		}
	}

	const cashValue = breakdown.filter((s) => s.isCash).reduce((sum, s) => sum + s.value, 0);
	const equitiesValue = breakdown.filter((s) => !s.isCash).reduce((sum, s) => sum + s.value, 0);
	const totalValue = cashValue + equitiesValue;

	return {
		totalValue,
		equitiesValue,
		cashValue,
		unrealizedPnl,
		hasPnl,
		breakdown,
	};
}

/** GMT+8 calendar date at UTC noon — stable key for one snapshot per day. */
export function snapshotDateGMT8(from = new Date()): Date {
	const day = from.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
	return new Date(`${day}T12:00:00.000Z`);
}

export function parseHoldingSlices(raw: unknown): HoldingSlice[] {
	if (!Array.isArray(raw)) return [];
	const out: HoldingSlice[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const o = item as Record<string, unknown>;
		if (typeof o.key !== "string" || typeof o.label !== "string") continue;
		const value = typeof o.value === "number" ? o.value : Number(o.value);
		if (!Number.isFinite(value) || value <= 0) continue;
		out.push({
			key: o.key,
			label: o.label,
			value,
			isCash: Boolean(o.isCash),
		});
	}
	return out;
}
