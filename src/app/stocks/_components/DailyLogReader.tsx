"use client";

import type { ReportBlock } from "@/lib/content/blocks";
import type { DailyLogDTO } from "@/lib/stocks/db";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";
import {
	FlaggedTickersPanel,
	TickerMoveBlocks,
} from "@/app/stocks/_components/TickerMoveBlocks";
import { parseFlaggedTickers } from "@/lib/stocks/splitTickerMoves";

function Section({
	title,
	blocks,
	card = false,
	moves = false,
}: {
	title: string;
	blocks: ReportBlock[] | null;
	card?: boolean;
	/** Split dense ticker walls into one row per name. */
	moves?: boolean;
}) {
	const body = moves ? (
		<TickerMoveBlocks blocks={blocks} emptyLabel="Empty" />
	) : (
		<ReportBlocks blocks={blocks} emptyLabel="Empty" className="space-y-3" />
	);

	if (card) {
		return (
			<div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 pt-4 pb-4 sm:px-5 sm:pt-5 sm:pb-5">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
					{title}
				</h3>
				{body}
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
			<div className="text-sm text-gray-800 leading-relaxed">{body}</div>
		</div>
	);
}

export function DailyLogReader({
	entry,
	embedded = false,
}: {
	entry: DailyLogDTO;
	embedded?: boolean;
}) {
	const flagged = entry.flaggedTickers ?? [];
	const flagCount = parseFlaggedTickers(flagged).reduce((n, g) => n + g.items.length, 0);

	return (
		<article className="space-y-7">
			<header className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-gray-100">
				{!embedded ? (
					<div>
						<h2 className="text-xl font-semibold text-gray-900">{entry.title}</h2>
					</div>
				) : null}
				<dl className={`flex flex-wrap gap-3 text-sm ${embedded ? "w-full" : ""}`}>
					<div className="rounded-lg bg-gray-50 px-3 py-2">
						<dt className="text-xs text-gray-500">Flags</dt>
						<dd className="font-medium tabular-nums">{flagCount || flagged.length}</dd>
					</div>
					<div className="rounded-lg bg-gray-50 px-3 py-2">
						<dt className="text-xs text-gray-500">Alert email</dt>
						<dd className="font-medium">
							{entry.alertEmailSent === null
								? "—"
								: entry.alertEmailSent
									? "Sent"
									: "Not sent"}
						</dd>
					</div>
					{entry.rulesVersion ? (
						<div className="rounded-lg bg-gray-50 px-3 py-2">
							<dt className="text-xs text-gray-500">Rules</dt>
							<dd className="font-medium">{entry.rulesVersion}</dd>
						</div>
					) : null}
				</dl>
			</header>

			{flagged.length > 0 ? <FlaggedTickersPanel tickers={flagged} /> : null}

			<Section title="Market context" blocks={entry.marketContext} />
			<Section title="Top news" blocks={entry.topNews} />
			<section className="grid grid-cols-1 gap-4">
				<Section title="Portfolio move" blocks={entry.portfolioMove} card moves />
				<Section title="Watchlist move" blocks={entry.watchlistMove} card moves />
			</section>
			<Section title="Action taken" blocks={entry.actionTaken} />
			<Section title="Notes" blocks={entry.notes} />
		</article>
	);
}
