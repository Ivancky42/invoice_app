import type { PortfolioSnapshotPoint } from "@/lib/stocks/db";

export type ChartInterval = "7d" | "1m" | "3m" | "6m" | "1y" | "all";

export const CHART_INTERVALS: { key: ChartInterval; label: string; days: number | null }[] = [
	{ key: "7d", label: "7D", days: 7 },
	{ key: "1m", label: "1M", days: 30 },
	{ key: "3m", label: "3M", days: 90 },
	{ key: "6m", label: "6M", days: 180 },
	{ key: "1y", label: "1Y", days: 365 },
	{ key: "all", label: "All", days: null },
];

export const DEFAULT_CHART_INTERVAL: ChartInterval = "3m";

/** Keep snapshots within N calendar days of the latest point (inclusive). */
export function filterSnapshotsByInterval(
	points: PortfolioSnapshotPoint[],
	interval: ChartInterval,
): PortfolioSnapshotPoint[] {
	if (points.length === 0 || interval === "all") return points;

	const spec = CHART_INTERVALS.find((i) => i.key === interval);
	const days = spec?.days;
	if (!days) return points;

	const latestMs = new Date(points[points.length - 1]!.snapshotDate).getTime();
	const cutoffMs = latestMs - days * 24 * 60 * 60 * 1000;

	return points.filter((p) => new Date(p.snapshotDate).getTime() >= cutoffMs);
}

/** Sensible default when history is shorter than the nominal interval. */
export function defaultChartInterval(pointCount: number): ChartInterval {
	if (pointCount <= 7) return "all";
	if (pointCount <= 30) return "1m";
	return DEFAULT_CHART_INTERVAL;
}
