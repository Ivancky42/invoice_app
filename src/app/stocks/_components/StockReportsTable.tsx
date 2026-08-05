"use client";

import { useEffect, useMemo, useState } from "react";
import type { StockReportDTO } from "@/lib/stocks/db";
import { StockReportReader } from "./StockReportReader";

type Filter = "all" | "WEEKLY" | "MONTHLY";

function fmtDate(entry: StockReportDTO): string {
	if (entry.reportDate) {
		try {
			return new Intl.DateTimeFormat("en-CA", {
				dateStyle: "medium",
				timeZone: "UTC",
			}).format(new Date(entry.reportDate));
		} catch {
			/* ignore */
		}
	}
	return entry.title.slice(0, 24);
}

function preview(entry: StockReportDTO): string {
	const first = entry.content.find(
		(b) => (b.type === "paragraph" || b.type === "heading_2") && "text" in b && b.text.trim(),
	);
	const raw = (first && "text" in first ? first.text : entry.title).replace(/\s+/g, " ").trim();
	if (raw.length <= 140) return raw;
	return `${raw.slice(0, 140)}…`;
}

function typeBadge(type: StockReportDTO["reportType"]) {
	return type === "WEEKLY" ? (
		<span className="badge bg-blue-50 text-blue-800 border border-blue-100">Weekly</span>
	) : (
		<span className="badge bg-violet-50 text-violet-800 border border-violet-100">Monthly</span>
	);
}

export function StockReportsTable({ rows }: { rows: StockReportDTO[] }) {
	const [filter, setFilter] = useState<Filter>("all");
	const [open, setOpen] = useState<StockReportDTO | null>(null);

	const filtered = useMemo(() => {
		if (filter === "all") return rows;
		return rows.filter((r) => r.reportType === filter);
	}, [rows, filter]);

	useEffect(() => {
		function onKey(ev: KeyboardEvent) {
			if (ev.key === "Escape") setOpen(null);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const weeklyCount = rows.filter((r) => r.reportType === "WEEKLY").length;
	const monthlyCount = rows.filter((r) => r.reportType === "MONTHLY").length;

	if (rows.length === 0) {
		return <p className="text-sm text-gray-500 py-8 text-center">No reports synced yet.</p>;
	}

	return (
		<>
			<div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-2">
				{(
					[
						["all", `All (${rows.length})`],
						["WEEKLY", `Weekly (${weeklyCount})`],
						["MONTHLY", `Monthly (${monthlyCount})`],
					] as const
				).map(([key, label]) => (
					<button
						key={key}
						type="button"
						onClick={() => setFilter(key)}
						className={`text-xs font-medium px-3 py-1.5 rounded-full transition ${
							filter === key
								? "bg-gray-900 text-white"
								: "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
						}`}
					>
						{label}
					</button>
				))}
			</div>

			<div className="overflow-x-auto">
				<table className="min-w-full text-sm">
					<thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
						<tr>
							<th className="text-left px-5 py-2">Date</th>
							<th className="text-left px-5 py-2">Type</th>
							<th className="text-left px-5 py-2">Title</th>
							<th className="text-left px-5 py-2 hidden md:table-cell">Preview</th>
							<th className="text-right px-5 py-2 w-36"> </th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{filtered.map((r, index) => (
							<tr key={r.id} className="hover:bg-gray-50 cursor-pointer align-top">
								<td className="px-5 py-3 tabular-nums text-gray-600 whitespace-nowrap" onClick={() => setOpen(r)}>
									<div className="flex flex-col gap-1">
										<span>{fmtDate(r)}</span>
										{index === 0 && filter !== "all" ? (
											<span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded w-fit">
												Latest
											</span>
										) : null}
									</div>
								</td>
								<td className="px-5 py-3" onClick={() => setOpen(r)}>
									{typeBadge(r.reportType)}
								</td>
								<td className="px-5 py-3 font-medium text-gray-900" onClick={() => setOpen(r)}>
									{r.title}
								</td>
								<td
									className="px-5 py-3 text-gray-500 text-xs hidden md:table-cell leading-snug max-w-md"
									onClick={() => setOpen(r)}
								>
									{preview(r)}
								</td>
								<td className="px-5 py-3 text-right whitespace-nowrap">
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											setOpen(r);
										}}
										className="text-sm font-medium text-gray-900 hover:underline"
									>
										View full
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{open ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50"
					onClick={(e) => {
						if (e.target === e.currentTarget) setOpen(null);
					}}
					role="dialog"
					aria-modal="true"
					aria-label="Report detail"
				>
					<div
						className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[min(92vh,900px)] overflow-y-auto overscroll-contain p-6 sm:p-8"
						onClick={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							onClick={() => setOpen(null)}
							className="sticky top-0 float-right mb-4 text-sm font-medium text-gray-500 hover:text-gray-900"
							aria-label="Close dialog"
						>
							Close ✕
						</button>
						<StockReportReader entry={open} />
					</div>
				</div>
			) : null}
		</>
	);
}
