"use client";

import { useEffect, useMemo, useState } from "react";
import { FormattedNoteText } from "@/app/stocks/_components/FormattedNoteText";

type DatedNoteEntry = { date: string; body: string };

type ParsedNotes = { preamble: string | null; entries: DatedNoteEntry[] };

/** Split notes like `…preamble…\n\n2026-05-13: …\n\n2026-05-14: …` into dated entries. */
function parseDatedNotes(text: string): ParsedNotes | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const chunks = trimmed.split(/\n(?=\d{4}-\d{2}-\d{2}:)/);
	const entries: DatedNoteEntry[] = [];
	let preamble: string | null = null;

	for (const chunk of chunks) {
		const m = /^(\d{4}-\d{2}-\d{2}):\s*([\s\S]*)$/.exec(chunk.trim());
		if (m) {
			const body = m[2].trim();
			if (body) entries.push({ date: m[1], body });
			continue;
		}
		const lead = chunk.trim();
		if (lead && entries.length === 0) preamble = lead;
	}

	if (entries.length === 0) return null;

	entries.sort((a, b) => b.date.localeCompare(a.date));
	return { preamble, entries };
}

function NotesModalBody({ text }: { text: string }) {
	const parsed = useMemo(() => parseDatedNotes(text), [text]);

	if (!parsed) {
		return (
			<p className="text-sm text-gray-800 leading-relaxed m-0">
				<FormattedNoteText text={text} />
			</p>
		);
	}

	const { preamble, entries } = parsed;

	return (
		<div className="space-y-3">
			{preamble ? (
				<div className="pb-1 mb-1 border-b border-gray-100">
					<div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
						Context
					</div>
					<p className="text-sm text-gray-700 leading-relaxed m-0">
						<FormattedNoteText text={preamble} />
					</p>
				</div>
			) : null}
			{entries.map((entry, index) => {
				const isLatest = index === 0;
				return (
					<div
						key={`${entry.date}-${index}`}
						className={
							isLatest
								? "rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3.5 shadow-sm"
								: "rounded-lg border border-gray-100 bg-gray-50/40 px-4 py-3.5"
						}
					>
						<div className="flex flex-wrap items-center gap-2 mb-2">
							<time
								dateTime={entry.date}
								className={`text-xs font-semibold tabular-nums ${isLatest ? "text-emerald-900" : "text-gray-700"}`}
							>
								{entry.date}
							</time>
							{isLatest ? (
								<span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
									Latest
								</span>
							) : null}
						</div>
						<p className="text-sm text-gray-800 leading-relaxed m-0">
							<FormattedNoteText text={entry.body} />
						</p>
					</div>
				);
			})}
		</div>
	);
}

export function NotesModalField({
	label,
	text,
	context,
}: {
	label: string;
	text: string;
	/** Shown in the modal header, e.g. ticker symbol. */
	context?: string;
}) {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!open) return;
		function onKey(ev: KeyboardEvent) {
			if (ev.key === "Escape") setOpen(false);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	const modalTitle = context ? `${context} — ${label}` : label;

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="inline-flex items-center text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 hover:border-gray-300 transition"
			>
				{label}
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
							<h3 className="font-semibold text-gray-900 leading-snug pr-2">{modalTitle}</h3>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="text-sm font-medium text-gray-500 hover:text-gray-900 shrink-0 -mr-1 px-1 py-0.5"
								aria-label="Close"
							>
								Close ✕
							</button>
						</div>
						<div className="overflow-y-auto overscroll-contain px-6 py-5">
							<NotesModalBody text={text} />
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
