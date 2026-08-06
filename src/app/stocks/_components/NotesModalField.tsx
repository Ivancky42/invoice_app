"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReportBlock } from "@/lib/content/blocks";
import {
	asReportBlocks,
	blocksToPlainText,
	isReportBlockArray,
	textToBlocks,
} from "@/lib/content/blocks";
import { parseStockNotes, type DatedNoteEntry } from "@/lib/stocks/parseStockNotes";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";
import { FormattedNoteText } from "@/app/stocks/_components/FormattedNoteText";

function normalizeNotes(
	text: ReportBlock[] | string | null | undefined,
): ReportBlock[] {
	if (text == null) return [];
	if (isReportBlockArray(text)) return text;
	if (typeof text === "string") return textToBlocks(text);
	return asReportBlocks(text);
}

/**
 * Prefer structured dated timeline when notes look like append-only ticker history.
 * Falls back to raw ReportBlocks for thesis-style prose.
 */
function tryDatedTimeline(blocks: ReportBlock[]): {
	preamble: string | null;
	entries: DatedNoteEntry[];
} | null {
	if (blocks.length === 0) return null;

	// Many separate dated paragraphs (agent append_page_notes over time).
	const perBlock: DatedNoteEntry[] = [];
	let allDated = blocks.length > 1;
	for (const b of blocks) {
		if (b.type === "divider") continue;
		const text =
			"text" in b && typeof b.text === "string"
				? b.text
				: b.type === "table"
					? ""
					: "";
		if (!text.trim()) {
			allDated = false;
			break;
		}
		const parsed = parseStockNotes(text);
		if (parsed && parsed.entries.length === 1 && !parsed.preamble) {
			perBlock.push(parsed.entries[0]!);
		} else if (parsed && parsed.entries.length > 1) {
			return parsed;
		} else {
			allDated = false;
			break;
		}
	}
	if (allDated && perBlock.length > 1) {
		perBlock.sort((a, b) => b.date.localeCompare(a.date));
		return { preamble: null, entries: perBlock };
	}

	const flat = blocksToPlainText(blocks);
	return parseStockNotes(flat);
}

function DatedNotesTimeline({
	preamble,
	entries,
}: {
	preamble: string | null;
	entries: DatedNoteEntry[];
}) {
	return (
		<div className="space-y-4">
			{preamble ? (
				<p className="text-sm text-gray-600 leading-relaxed border-b border-gray-100 pb-3">
					<FormattedNoteText text={preamble} />
				</p>
			) : null}
			<ol className="space-y-3">
				{entries.map((e, i) => (
					<li
						key={`${e.date}-${i}`}
						className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5"
					>
						<div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1 tabular-nums">
							{e.label}
						</div>
						<div className="text-sm text-gray-800 leading-relaxed">
							<FormattedNoteText
								text={(() => {
									const lines = e.body.split("\n");
									const first = (lines[0] ?? "").trim();
									if (
										first === e.label ||
										first.startsWith(`${e.label} |`) ||
										first.startsWith(`${e.label}|`) ||
										/^\d{4}-\d{2}-\d{2}:/.test(first)
									) {
										const rest = lines.slice(1).join("\n").trim();
										// Keep first line if it has content after the date (pipe notes).
										if (first.includes("|") && first.length > e.label.length + 2) {
											return first.replace(/^[^\|]*\|\s*/, "") + (rest ? `\n${rest}` : "");
										}
										return rest || e.body;
									}
									return e.body;
								})()}
							/>
						</div>
					</li>
				))}
			</ol>
		</div>
	);
}

export function NotesModalField({
	label,
	text,
	context,
}: {
	label: string;
	/** ReportBlock[] preferred; legacy string accepted during transition. */
	text: ReportBlock[] | string | null | undefined;
	/** Shown in the modal header, e.g. ticker symbol. */
	context?: string;
}) {
	const [open, setOpen] = useState(false);
	const blocks = useMemo(() => normalizeNotes(text), [text]);
	const timeline = useMemo(() => tryDatedTimeline(blocks), [blocks]);

	useEffect(() => {
		if (!open) return;
		function onKey(ev: KeyboardEvent) {
			if (ev.key === "Escape") setOpen(false);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	if (blocks.length === 0) return null;

	const modalTitle = context ? `${context} — ${label}` : label;
	const entryCount = timeline?.entries.length ?? 0;

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 hover:border-gray-300 transition"
			>
				{label}
				{entryCount > 1 ? (
					<span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
						{entryCount}
					</span>
				) : null}
			</button>

			{open ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-10 bg-black/40"
					onClick={(e) => {
						if (e.target === e.currentTarget) setOpen(false);
					}}
					role="dialog"
					aria-modal="true"
					aria-label={modalTitle}
				>
					<div
						className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[min(92vh,900px)] flex flex-col"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100 shrink-0">
							<div>
								<h3 className="font-semibold text-gray-900 leading-snug pr-2">{modalTitle}</h3>
								{entryCount > 1 ? (
									<p className="text-xs text-gray-500 mt-0.5">
										Newest first · {entryCount} dated entries
									</p>
								) : null}
							</div>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="text-sm font-medium text-gray-500 hover:text-gray-900 shrink-0 -mr-1 px-1 py-0.5"
								aria-label="Close"
							>
								Close
							</button>
						</div>
						<div className="overflow-y-auto overscroll-contain px-6 py-5">
							{timeline && timeline.entries.length > 0 ? (
								<DatedNotesTimeline
									preamble={timeline.preamble}
									entries={timeline.entries}
								/>
							) : (
								<ReportBlocks blocks={blocks} />
							)}
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
