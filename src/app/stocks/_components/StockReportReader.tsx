"use client";

import type { StockReportDTO } from "@/lib/stocks/db";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";
import { TickerMoveBlocks } from "@/app/stocks/_components/TickerMoveBlocks";

function reportTypeLabel(type: StockReportDTO["reportType"]): string {
	return type === "WEEKLY" ? "Weekly" : "Monthly";
}

function reportTypeBadgeClass(type: StockReportDTO["reportType"]): string {
	return type === "WEEKLY"
		? "bg-blue-50 text-blue-800 border-blue-100"
		: "bg-violet-50 text-violet-800 border-violet-100";
}

export function StockReportReader({
	entry,
	embedded = false,
}: {
	entry: StockReportDTO;
	embedded?: boolean;
}) {
	const content = entry.content ?? [];
	const hasStructure = content.some(
		(b) =>
			b.type === "table" ||
			b.type === "heading_1" ||
			b.type === "heading_2" ||
			b.type === "heading_3" ||
			b.type === "bulleted_list_item" ||
			b.type === "numbered_list_item",
	);

	return (
		<article className="space-y-6">
			{!embedded ? (
				<header className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-gray-100">
					<div>
						<span
							className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border mb-2 ${reportTypeBadgeClass(entry.reportType)}`}
						>
							{reportTypeLabel(entry.reportType)}
						</span>
						<h2 className="text-xl font-semibold text-gray-900">{entry.title}</h2>
					</div>
				</header>
			) : null}
			{hasStructure ? (
				<ReportBlocks blocks={content} className="space-y-5" />
			) : (
				<TickerMoveBlocks blocks={content} />
			)}
		</article>
	);
}
