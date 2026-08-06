"use client";

import type { ReportBlock } from "@/lib/content/blocks";
import { FormattedNoteText } from "@/app/stocks/_components/FormattedNoteText";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";
import {
	parseFlaggedTickers,
	splitTickerMoveLines,
	type FlaggedGroup,
} from "@/lib/stocks/splitTickerMoves";

/** Render portfolio/watchlist move blocks with one visual row per ticker when possible. */
export function TickerMoveBlocks({
	blocks,
	emptyLabel = "Empty",
}: {
	blocks: ReportBlock[] | null | undefined;
	emptyLabel?: string;
}) {
	if (!blocks || blocks.length === 0) {
		return <p className="text-sm text-gray-400 italic m-0">{emptyLabel}</p>;
	}

	// Prefer real tables / lists from agents — don't re-split those.
	const hasStructure = blocks.some(
		(b) =>
			b.type === "table" ||
			b.type === "bulleted_list_item" ||
			b.type === "numbered_list_item" ||
			b.type === "heading_1" ||
			b.type === "heading_2" ||
			b.type === "heading_3",
	);
	if (hasStructure) {
		return <ReportBlocks blocks={blocks} className="space-y-3" emptyLabel={emptyLabel} />;
	}

	const rows: string[] = [];
	for (const b of blocks) {
		if (b.type === "paragraph" && "text" in b && b.text.trim()) {
			const split = splitTickerMoveLines(b.text);
			if (split) rows.push(...split);
			else rows.push(b.text.trim());
		} else if (b.type === "quote" || b.type === "callout") {
			if ("text" in b && b.text.trim()) rows.push(b.text.trim());
		}
	}

	if (rows.length === 0) {
		return <ReportBlocks blocks={blocks} className="space-y-3" emptyLabel={emptyLabel} />;
	}

	const multi = rows.length > 1 || (rows[0] && splitTickerMoveLines(rows[0]) !== null);

	if (!multi && rows.length === 1) {
		return (
			<p className="text-sm leading-relaxed text-gray-800 m-0">
				<FormattedNoteText text={rows[0]!} />
			</p>
		);
	}

	return (
		<ul className="space-y-2 m-0 p-0 list-none">
			{rows.map((line, i) => (
				<li
					key={i}
					className="text-sm leading-snug text-gray-800 px-3 py-2 rounded-lg bg-white/70 border border-gray-100/80"
				>
					<FormattedNoteText text={line} />
				</li>
			))}
		</ul>
	);
}

function chipClass(tone: FlaggedGroup["tone"]): string {
	switch (tone) {
		case "up":
			return "bg-emerald-50 text-emerald-900 border-emerald-100";
		case "down":
			return "bg-red-50 text-red-900 border-red-100";
		default:
			return "bg-gray-50 text-gray-800 border-gray-200";
	}
}

export function FlaggedTickersPanel({ tickers }: { tickers: string[] }) {
	const groups = parseFlaggedTickers(tickers);
	if (groups.length === 0) return null;

	return (
		<section className="space-y-3">
			<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
				Flagged tickers
			</h3>
			<div className="space-y-3">
				{groups.map((g, gi) => (
					<div key={gi} className="space-y-1.5">
						{g.label ? (
							<div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
								{g.label}
							</div>
						) : null}
						<div className="flex flex-wrap gap-1.5">
							{g.items.map((it, ii) => (
								<span
									key={`${it.ticker}-${ii}`}
									className={`inline-flex items-baseline gap-1.5 text-xs font-medium border rounded-md px-2 py-1 ${chipClass(g.tone)}`}
								>
									<span className="tracking-wide tabular-nums font-semibold">{it.ticker}</span>
									{it.detail ? (
										<span className="tabular-nums opacity-90">{it.detail}</span>
									) : null}
								</span>
							))}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
