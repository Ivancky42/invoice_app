"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReportBlock } from "@/lib/content/blocks";
import {
	asReportBlocks,
	blocksToPlainText,
	isReportBlockArray,
	textToBlocks,
} from "@/lib/content/blocks";
import {
	mergeParsedNotes,
	noteEntryDisplayBody,
	parseStockNotes,
	type DatedNoteEntry,
} from "@/lib/stocks/parseStockNotes";
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

function blockPlainText(b: ReportBlock): string {
	if ("text" in b && typeof b.text === "string") return b.text;
	return "";
}

/**
 * Prefer structured dated timeline when notes look like append-only ticker history.
 * Merges every ReportBlock so newer agent appends are not dropped behind older bulk history.
 */
function tryDatedTimeline(blocks: ReportBlock[]): {
	preamble: string | null;
	entries: DatedNoteEntry[];
} | null {
	if (blocks.length === 0) return null;

	const perBlock = blocks
		.filter((b) => b.type !== "divider")
		.map((b) => {
			const text = blockPlainText(b);
			return text.trim() ? parseStockNotes(text) : null;
		});

	const merged = mergeParsedNotes(perBlock);
	if (merged && merged.entries.length > 0) return merged;

	const flat = blocksToPlainText(blocks);
	return parseStockNotes(flat);
}

function formatEntryLabel(entry: DatedNoteEntry): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.date);
	if (!m) return entry.label;
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	const month = months[parseInt(m[2]!, 10) - 1] ?? m[2];
	return `${month} ${parseInt(m[3]!, 10)}, ${m[1]}`;
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
						<div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 tabular-nums">
							{formatEntryLabel(e)}
						</div>
						<div className="text-sm text-gray-800 leading-relaxed">
							<FormattedNoteText text={noteEntryDisplayBody(e)} />
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
	const newest = timeline?.entries[0];

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 hover:border-gray-300 transition"
			>
				{label}
				{entryCount > 0 ? (
					<span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 tabular-nums">
						{entryCount > 1 ? `${entryCount}` : formatEntryLabel(newest!)}
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
								{entryCount > 0 ? (
									<p className="text-xs text-gray-500 mt-0.5">
										Newest first
										{entryCount > 1 ? ` · ${entryCount} dated entries` : null}
										{newest ? ` · latest ${formatEntryLabel(newest)}` : null}
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
