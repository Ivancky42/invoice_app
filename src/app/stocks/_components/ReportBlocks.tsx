"use client";

import type { ReactNode } from "react";
import type { ReportBlock } from "@/lib/content/blocks";
import { FormattedNoteText } from "@/app/stocks/_components/FormattedNoteText";

function ReportTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
	if (rows.length === 0 && headers.length === 0) {
		return <p className="text-sm text-gray-400 italic">Empty table</p>;
	}

	const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);

	return (
		<div className="overflow-x-auto -mx-1">
			<table className="min-w-full text-sm border-collapse">
				{headers.length > 0 ? (
					<thead>
						<tr className="border-b border-gray-200 bg-gray-50/80">
							{headers.map((h, i) => (
								<th
									key={i}
									className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap"
								>
									{h || "—"}
								</th>
							))}
						</tr>
					</thead>
				) : null}
				<tbody className="divide-y divide-gray-100">
					{rows.map((row, ri) => (
						<tr key={ri} className="align-top hover:bg-gray-50/50">
							{Array.from({ length: colCount }, (_, ci) => (
								<td key={ci} className="px-3 py-2.5 text-gray-800 leading-snug whitespace-pre-wrap">
									{row[ci] ? <FormattedNoteText text={row[ci]} /> : "—"}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function ReportBlockView({ block, index }: { block: ReportBlock; index: number }) {
	switch (block.type) {
		case "paragraph":
			if (!block.text.trim()) return null;
			return (
				<p key={index} className="text-sm leading-relaxed text-gray-800 m-0">
					<FormattedNoteText text={block.text} />
				</p>
			);
		case "heading_1":
			return (
				<h2 key={index} className="text-xl font-semibold text-gray-900 mt-8 mb-3 first:mt-0">
					{block.text}
				</h2>
			);
		case "heading_2":
			return (
				<h3 key={index} className="text-lg font-semibold text-gray-900 mt-8 mb-3 first:mt-0">
					{block.text}
				</h3>
			);
		case "heading_3":
			return (
				<h4 key={index} className="text-base font-semibold text-gray-900 mt-6 mb-2">
					{block.text}
				</h4>
			);
		case "quote":
		case "callout":
			return (
				<blockquote
					key={index}
					className="border-l-4 border-emerald-300 bg-emerald-50/50 px-4 py-3 text-sm text-gray-800 leading-relaxed rounded-r-lg"
				>
					<FormattedNoteText text={block.text} />
				</blockquote>
			);
		case "divider":
			return <hr key={index} className="border-gray-200 my-6" />;
		case "table":
			return (
				<div key={index} className="my-4 rounded-lg border border-gray-200 overflow-hidden">
					<ReportTable headers={block.headers} rows={block.rows} />
				</div>
			);
		case "bulleted_list_item":
			return (
				<li key={index} className="text-sm leading-relaxed text-gray-800 ml-4 list-disc">
					<span>
						<FormattedNoteText text={block.text} />
					</span>
					{block.children?.length ? (
						<ul className="mt-2 space-y-1 list-disc ml-4">
							{block.children.map((child, ci) => (
								<ReportBlockView key={ci} block={child} index={ci} />
							))}
						</ul>
					) : null}
				</li>
			);
		case "numbered_list_item":
			return (
				<li key={index} className="text-sm leading-relaxed text-gray-800 ml-4 list-decimal">
					<span>
						<FormattedNoteText text={block.text} />
					</span>
					{block.children?.length ? (
						<ol className="mt-2 space-y-1 list-decimal ml-4">
							{block.children.map((child, ci) => (
								<ReportBlockView key={ci} block={child} index={ci} />
							))}
						</ol>
					) : null}
				</li>
			);
		default:
			return null;
	}
}

export function ReportBlocks({
	blocks,
	className = "space-y-4",
	emptyLabel = "Empty",
}: {
	blocks: ReportBlock[] | null | undefined;
	className?: string;
	emptyLabel?: string;
}) {
	if (!blocks || blocks.length === 0) {
		return <p className="text-sm text-gray-400 italic m-0">{emptyLabel}</p>;
	}

	const elements: ReactNode[] = [];
	let listBuffer: { type: "bulleted_list_item" | "numbered_list_item"; items: ReportBlock[] } | null =
		null;

	function flushList() {
		if (!listBuffer || listBuffer.items.length === 0) return;
		const Tag = listBuffer.type === "bulleted_list_item" ? "ul" : "ol";
		const listClass =
			listBuffer.type === "bulleted_list_item" ? "list-disc space-y-2 pl-5" : "list-decimal space-y-2 pl-5";
		elements.push(
			<Tag key={`list-${elements.length}`} className={listClass}>
				{listBuffer.items.map((item, i) => (
					<ReportBlockView key={i} block={item} index={i} />
				))}
			</Tag>,
		);
		listBuffer = null;
	}

	for (const block of blocks) {
		if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
			if (listBuffer && listBuffer.type !== block.type) flushList();
			if (!listBuffer) listBuffer = { type: block.type, items: [] };
			listBuffer.items.push(block);
		} else {
			flushList();
			elements.push(<ReportBlockView key={elements.length} block={block} index={elements.length} />);
		}
	}
	flushList();

	return <div className={className}>{elements}</div>;
}
