/** Shared donut / chart colors for portfolio holdings. */
export const TICKER_PALETTE = [
	"#6366f1",
	"#8b5cf6",
	"#ec4899",
	"#f43f5e",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#14b8a6",
	"#0ea5e9",
	"#3b82f6",
] as const;

export const CASH_CHART_COLOR = "#64748b";

/** Stable color per ticker key for a given stack order. */
export function colorForHoldingKey(key: string, orderedKeys: string[]): string {
	if (key === "CASH_USD") return CASH_CHART_COLOR;

	const equityKeys = orderedKeys.filter(
		(k) => k !== "CASH_USD" && k !== "EQUITIES" && k !== "TOTAL",
	);
	const idx = equityKeys.indexOf(key);
	if (idx >= 0) return TICKER_PALETTE[idx % TICKER_PALETTE.length]!;

	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash + key.charCodeAt(i)) % TICKER_PALETTE.length;
	}
	return TICKER_PALETTE[hash]!;
}
