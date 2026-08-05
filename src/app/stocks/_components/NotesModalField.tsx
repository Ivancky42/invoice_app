"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReportBlock } from "@/lib/content/blocks";
import { asReportBlocks, isReportBlockArray, textToBlocks } from "@/lib/content/blocks";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";

function normalizeNotes(
	text: ReportBlock[] | string | null | undefined,
): ReportBlock[] {
	if (text == null) return [];
	if (isReportBlockArray(text)) return text;
	if (typeof text === "string") return textToBlocks(text);
	return asReportBlocks(text);
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
							<ReportBlocks blocks={blocks} />
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
