/** Palette for portfolio-by-value and sector donuts + stacked bar chart. */
export const PORTFOLIO_TICKER_PALETTE = [
	"#2563eb",
	"#10b981",
	"#f59e0b",
	"#ef4444",
	"#8b5cf6",
	"#ec4899",
	"#14b8a6",
	"#f97316",
	"#6366f1",
	"#84cc16",
] as const;

export const CASH_DONUT_COLOR = "#64748b";

export type ColorSlice = {
	key: string;
	value: number;
	isCash: boolean;
};

/**
 * Assign colors the same way as the portfolio breakdown donut:
 * equities sorted by value (desc) → palette in order; cash → slate.
 */
export function assignPortfolioValueColors(slices: ColorSlice[]): Map<string, string> {
	const colors = new Map<string, string>();

	const equities = slices
		.filter((s) => !s.isCash && s.key !== "CASH_USD")
		.sort((a, b) => b.value - a.value);

	equities.forEach((s, i) => {
		colors.set(s.key, PORTFOLIO_TICKER_PALETTE[i % PORTFOLIO_TICKER_PALETTE.length]!);
	});

	for (const s of slices) {
		if (s.isCash || s.key === "CASH_USD") {
			colors.set(s.key, CASH_DONUT_COLOR);
		}
	}

	return colors;
}

export function getPortfolioHoldingColor(
	colorMap: Map<string, string>,
	key: string,
	fallbackIndex = 0,
): string {
	if (key === "CASH_USD") return CASH_DONUT_COLOR;
	return (
		colorMap.get(key) ??
		PORTFOLIO_TICKER_PALETTE[fallbackIndex % PORTFOLIO_TICKER_PALETTE.length]!
	);
}
