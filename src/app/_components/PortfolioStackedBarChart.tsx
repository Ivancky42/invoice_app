import { fmtMoney, fmtMoneyFixed, fmtPct, fmtShortDateUtc } from "@/lib/stocks/format";
import {
	assignPortfolioValueColors,
	getPortfolioHoldingColor,
} from "@/lib/stocks/chartColors";
import type { HoldingSlice } from "@/lib/stocks/portfolioTotals";
import type { PortfolioSnapshotPoint } from "@/lib/stocks/db";

type Props = {
	points: PortfolioSnapshotPoint[];
	width?: number;
};

/** Round SVG geometry so server/client floating-point output matches. */
function svgNum(n: number): number {
	return Math.round(n * 100) / 100;
}

function fmtAxisMoney(n: number): string {
	if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 10_000) return `$${Math.round(n / 1000)}k`;
	return fmtMoney(n);
}

/** Older snapshots may lack per-ticker JSON — fall back to equities + cash aggregates. */
function effectiveBreakdown(point: PortfolioSnapshotPoint): HoldingSlice[] {
	if (point.holdings.length > 0) return point.holdings;

	const fallback: HoldingSlice[] = [];
	if (point.equitiesValue !== null && point.equitiesValue > 0) {
		fallback.push({
			key: "EQUITIES",
			label: "Equities",
			value: point.equitiesValue,
			isCash: false,
		});
	}
	if (point.cashValue !== null && point.cashValue > 0) {
		fallback.push({
			key: "CASH_USD",
			label: "Cash",
			value: point.cashValue,
			isCash: true,
		});
	}
	if (fallback.length === 0 && point.totalValue > 0) {
		fallback.push({
			key: "TOTAL",
			label: "Total",
			value: point.totalValue,
			isCash: false,
		});
	}
	return fallback.sort((a, b) => b.value - a.value);
}

function sliceValue(breakdown: HoldingSlice[], key: string): number {
	return breakdown.find((s) => s.key === key)?.value ?? 0;
}

/** Stack order: largest segment at the bottom, consistent across all days. */
function stackKeys(points: PortfolioSnapshotPoint[]): string[] {
	const latest = points[points.length - 1];
	if (!latest) return [];

	const latestBreakdown = effectiveBreakdown(latest);
	const keySet = new Set<string>();
	for (const p of points) {
		for (const s of effectiveBreakdown(p)) {
			keySet.add(s.key);
		}
	}

	const ordered = [...keySet].sort((a, b) => {
		const va = sliceValue(latestBreakdown, a);
		const vb = sliceValue(latestBreakdown, b);
		if (vb !== va) return vb - va;
		return a.localeCompare(b);
	});

	return ordered;
}

function legendEntries(
	keys: string[],
	points: PortfolioSnapshotPoint[],
	colorMap: Map<string, string>,
) {
	const latest = points[points.length - 1];
	const latestBreakdown = latest ? effectiveBreakdown(latest) : [];
	return keys.map((key, i) => {
		const sample = latestBreakdown.find((s) => s.key === key);
		const value = sliceValue(latestBreakdown, key);
		return {
			key,
			label: sample?.label ?? key,
			color: getPortfolioHoldingColor(colorMap, key, i),
			value,
		};
	});
}

type LegendItem = ReturnType<typeof legendEntries>[number];

function ChartLegend({
	items,
	totalValue,
	className = "",
}: {
	items: LegendItem[];
	totalValue: number;
	className?: string;
}) {
	if (items.length === 0) return null;

	return (
		<div className={`shrink-0 ${className}`}>
			<p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-2">Holdings</p>
			<ul className="space-y-1.5">
				{items.map((item) => {
					const pct = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
					return (
						<li key={item.key} className="flex items-center justify-between gap-2 text-xs">
							<div className="flex items-center min-w-0">
								<span
									className="inline-block h-2 w-2 rounded-sm shrink-0"
									style={{ backgroundColor: item.color }}
									aria-hidden
								/>
								<span className="ml-2 text-gray-700 truncate">{item.label}</span>
							</div>
							<div className="text-right tabular-nums shrink-0 leading-tight">
								<div className="text-[11px] text-gray-800">{fmtMoney(item.value)}</div>
								<div className="text-[10px] text-gray-400">{pct.toFixed(1)}%</div>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function chartHeight(legendCount: number, barCount: number): number {
	const legendEstimate = 24 + legendCount * 34;
	const barFloor = barCount <= 1 ? 240 : 280;
	return Math.max(barFloor, legendEstimate);
}

/**
 * Stacked vertical bar chart — one bar per day, segments by holding + cash.
 */
export function PortfolioStackedBarChart({ points, width = 640 }: Props) {
	if (points.length === 0) {
		return (
			<p className="text-sm text-gray-500 py-8 text-center">
				No history yet. Run a Notion→Neon sync to record the first daily snapshot.
			</p>
		);
	}

	const enriched = points.map((p) => ({
		...p,
		breakdown: effectiveBreakdown(p),
	}));

	const keys = stackKeys(enriched);
	const latest = enriched[enriched.length - 1]!;
	const first = enriched[0]!;
	const latestBreakdown = effectiveBreakdown(latest);
	const colorMap = assignPortfolioValueColors(
		latestBreakdown.map((s) => ({ key: s.key, value: s.value, isCash: s.isCash })),
	);
	const legend = legendEntries(keys, enriched, colorMap);
	const height = chartHeight(legend.length, enriched.length);

	const periodReturn =
		first.totalValue > 0 ? ((latest.totalValue - first.totalValue) / first.totalValue) * 100 : null;

	const pad = { top: 12, right: 12, bottom: 32, left: 52 };
	const innerW = width - pad.left - pad.right;
	const innerH = height - pad.top - pad.bottom;

	const maxTotal = Math.max(...enriched.map((p) => p.totalValue), 1);
	const yMax = maxTotal * 1.05;

	const barGap = enriched.length > 14 ? 4 : enriched.length > 7 ? 6 : 10;
	const barWidth = Math.max(12, (innerW - barGap * Math.max(enriched.length - 1, 0)) / enriched.length);

	const yTicks = [0, 0.5, 1].map((t) => ({
		value: yMax * t,
		y: svgNum(pad.top + innerH - t * innerH),
	}));

	const xLabelEvery = enriched.length <= 7 ? 1 : enriched.length <= 14 ? 2 : Math.ceil(enriched.length / 7);

	return (
		<div className="flex flex-col justify-end min-h-0">
			<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm mb-3">
				<span className="text-gray-500">
					Latest{" "}
					<span className="font-semibold text-gray-900 tabular-nums">{fmtMoney(latest.totalValue)}</span>
				</span>
				{latest.dailyReturnPct !== null ? (
					<span className={latest.dailyReturnPct >= 0 ? "text-emerald-700" : "text-red-700"}>
						Day {fmtPct(latest.dailyReturnPct / 100)}
					</span>
				) : null}
				{periodReturn !== null && enriched.length > 1 ? (
					<span className="text-gray-500">
						Period{" "}
						<span className={periodReturn >= 0 ? "text-emerald-700" : "text-red-700"}>
							{fmtPct(periodReturn / 100)}
						</span>
					</span>
				) : null}
				{enriched.length === 1 ? (
					<span className="text-xs text-gray-400">One day — more bars after the next sync</span>
				) : null}
			</div>

			<div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-5">
				{/* Wrapper avoids SVG collapsing to 0 width inside flex (common cause of invisible chart). */}
				<div className="w-full flex-1 min-w-0" style={{ height }}>
					<svg
						width={width}
						height={height}
						viewBox={`0 0 ${width} ${height}`}
						className="w-full h-full block"
						preserveAspectRatio="xMidYMax meet"
						role="img"
						aria-label="Daily portfolio value by holding"
					>
						{yTicks.map((t) => (
							<g key={t.value}>
								<line
									x1={pad.left}
									y1={t.y}
									x2={width - pad.right}
									y2={t.y}
									stroke="#f3f4f6"
									strokeWidth={1}
								/>
								<text
									x={pad.left - 6}
									y={t.y + 4}
									textAnchor="end"
									fontSize={10}
									className="fill-gray-400"
								>
									{fmtAxisMoney(t.value)}
								</text>
							</g>
						))}

						{enriched.map((point, i) => {
							const barX = svgNum(pad.left + i * (barWidth + barGap));
							let yCursor = pad.top + innerH;

							return (
								<g key={point.snapshotDate}>
									{keys.map((key) => {
										const val = sliceValue(point.breakdown, key);
										if (val <= 0) return null;
										const segH = (val / yMax) * innerH;
										yCursor -= segH;
										const y = svgNum(yCursor);
										const h = svgNum(Math.max(segH, 0.5));
										const color = getPortfolioHoldingColor(colorMap, key, keys.indexOf(key));
										const label = point.breakdown.find((s) => s.key === key)?.label ?? key;
										return (
											<rect
												key={key}
												x={barX}
												y={y}
												width={svgNum(barWidth)}
												height={h}
												fill={color}
												stroke="#fff"
												strokeWidth={0.5}
											>
												<title>{`${fmtShortDateUtc(point.snapshotDate)} - ${label}: ${fmtMoneyFixed(val)}`}</title>
											</rect>
										);
									})}
									{i % xLabelEvery === 0 || i === enriched.length - 1 ? (
										<text
											x={svgNum(barX + barWidth / 2)}
											y={height - 8}
											textAnchor="middle"
											fontSize={10}
											className="fill-gray-500"
										>
											{fmtShortDateUtc(point.snapshotDate)}
										</text>
									) : null}
								</g>
							);
						})}
					</svg>
				</div>

				<ChartLegend
					items={legend}
					totalValue={latest.totalValue}
					className="w-full sm:w-40 lg:w-44 sm:border-l sm:border-gray-100 sm:pl-4 pb-1"
				/>
			</div>
		</div>
	);
}
