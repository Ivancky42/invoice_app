"use client";

import { useMemo, useState } from "react";
import { PortfolioStackedBarChart } from "@/app/_components/PortfolioStackedBarChart";
import type { PortfolioSnapshotPoint } from "@/lib/stocks/db";
import {
	CHART_INTERVALS,
	defaultChartInterval,
	filterSnapshotsByInterval,
	type ChartInterval,
} from "@/lib/stocks/snapshotFilters";

type Props = {
	points: PortfolioSnapshotPoint[];
};

export function PortfolioChartPanel({ points }: Props) {
	const [interval, setInterval] = useState<ChartInterval>(() => defaultChartInterval(points.length));

	const filtered = useMemo(() => {
		const result = filterSnapshotsByInterval(points, interval);
		// Never show an empty chart when we have data (e.g. edge-case date math).
		return result.length > 0 ? result : points;
	}, [points, interval]);

	if (points.length === 0) {
		return <PortfolioStackedBarChart points={[]} />;
	}

	return (
		<div className="flex flex-col">
			<div className="flex flex-wrap items-center justify-end gap-2 mb-4">
				{CHART_INTERVALS.map(({ key, label }) => (
					<button
						key={key}
						type="button"
						onClick={() => setInterval(key)}
						className={`text-xs font-medium px-3 py-1.5 rounded-full transition ${
							interval === key
								? "bg-gray-900 text-white"
								: "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
						}`}
					>
						{label}
					</button>
				))}
			</div>

			<PortfolioStackedBarChart points={filtered} />
		</div>
	);
}
