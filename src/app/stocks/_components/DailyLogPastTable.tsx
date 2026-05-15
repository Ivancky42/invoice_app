"use client";

import { useEffect, useState } from "react";
import type { DailyLogDTO } from "@/lib/stocks/db";
import { DailyLogReader } from "./DailyLogReader";

function fmtShortDate(entry: DailyLogDTO): string {
	if (entry.logDate) {
		try {
			return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(entry.logDate));
		} catch {
			/* ignore */
		}
	}
	return entry.title.slice(0, 10);
}

function preview(marketContext: string | null, fallback: string): string {
	const raw = (marketContext ?? fallback)?.replace(/\s+/g, " ").trim() ?? "";
	if (raw.length <= 140) return raw;
	return `${raw.slice(0, 140)}…`;
}

export function DailyLogPastTable({ rows }: { rows: DailyLogDTO[] }) {
	const [open, setOpen] = useState<DailyLogDTO | null>(null);

	useEffect(() => {
		function onKey(ev: KeyboardEvent) {
			if (ev.key === "Escape") setOpen(null);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	if (rows.length === 0) {
		return <p className="text-sm text-gray-500 py-8 text-center">No daily logs synced yet.</p>;
	}

	return (
		<>
			<div className="overflow-x-auto">
				<table className="min-w-full text-sm">
					<thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
						<tr>
							<th className="text-left px-5 py-2">Date</th>
							<th className="text-left px-5 py-2">Title</th>
							<th className="text-right px-5 py-2">Flags</th>
							<th className="text-left px-5 py-2 hidden lg:table-cell">Flagged tickers</th>
							<th className="text-center px-5 py-2">Alert email</th>
							<th className="text-left px-5 py-2 hidden md:table-cell">Preview</th>
							<th className="text-right px-5 py-2 w-36"> </th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{rows.map((r, index) => (
							<tr key={r.notionId} className="hover:bg-gray-50 cursor-pointer align-top">
								<td className="px-5 py-3 tabular-nums text-gray-600 whitespace-nowrap" onClick={() => setOpen(r)}>
									<div className="flex flex-col gap-1">
										<span>{fmtShortDate(r)}</span>
										{index === 0 ? (
											<span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded w-fit">
												Latest
											</span>
										) : null}
									</div>
								</td>
								<td className="px-5 py-3 font-medium text-gray-900" onClick={() => setOpen(r)}>
									{r.title}
								</td>
								<td className="px-5 py-3 text-right tabular-nums">{r.flagsCount ?? "—"}</td>
								<td
									className="px-5 py-3 text-gray-600 max-w-[14rem] truncate hidden lg:table-cell"
									title={r.flaggedTickers ?? undefined}
									onClick={() => setOpen(r)}
								>
									{r.flaggedTickers ?? "—"}
								</td>
								<td className="px-5 py-3 text-center" onClick={() => setOpen(r)}>
									{r.alertEmailSent === null ? (
										<span className="text-gray-400">—</span>
									) : r.alertEmailSent ? (
										<span className="badge bg-emerald-100 text-emerald-800">Yes</span>
									) : (
										<span className="badge bg-gray-100 text-gray-600">No</span>
									)}
								</td>
								<td
									className="px-5 py-3 text-gray-500 text-xs hidden md:table-cell leading-snug max-w-md"
									onClick={() => setOpen(r)}
								>
									{preview(r.marketContext, "")}
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
					aria-label="Daily log detail"
				>
					<div
						className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[min(92vh,900px)] overflow-y-auto overscroll-contain p-6 sm:p-8"
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
						<DailyLogReader entry={open} />
					</div>
				</div>
			) : null}
		</>
	);
}
