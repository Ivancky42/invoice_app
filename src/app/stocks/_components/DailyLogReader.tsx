"use client";

import type { ReportBlock } from "@/lib/content/blocks";
import type { DailyLogDTO } from "@/lib/stocks/db";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";

function Section({
	title,
	blocks,
	card = false,
}: {
	title: string;
	blocks: ReportBlock[] | null;
	card?: boolean;
}) {
	const body = <ReportBlocks blocks={blocks} emptyLabel="Empty" />;

	if (card) {
		return (
			<div className="rounded-xl border border-emerald-100/50 bg-emerald-50/40 px-5 pt-5 pb-6 shadow-sm">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800/70 mb-4">
					{title}
				</h3>
				{body}
			</div>
		);
	}

	return (
		<div>
			<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
				{title}
			</h3>
			{body}
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

	return (
		<article className="space-y-6">
			<header className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-gray-100">
				{!embedded ? (
					<div>
						<h2 className="text-xl font-semibold text-gray-900">{entry.title}</h2>
					</div>
				) : null}
				<dl className={`flex flex-wrap gap-3 text-sm ${embedded ? "w-full" : ""}`}>
					<div className="rounded-lg bg-gray-50 px-3 py-2">
						<dt className="text-xs text-gray-500">Flags</dt>
						<dd className="font-medium tabular-nums">{flagged.length}</dd>
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

			{flagged.length > 0 ? (
				<section>
					<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
						Flagged tickers
					</h3>
					<p className="text-sm text-gray-800 tracking-wide">{flagged.join(", ")}</p>
				</section>
			) : null}

			<Section title="Market context" blocks={entry.marketContext} />
			<Section title="Top news" blocks={entry.topNews} />
			<section className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<Section title="Portfolio move" blocks={entry.portfolioMove} card />
				<Section title="Watchlist move" blocks={entry.watchlistMove} card />
			</section>
			<Section title="Action taken" blocks={entry.actionTaken} />
			<Section title="Notes" blocks={entry.notes} />
		</article>
	);
}
