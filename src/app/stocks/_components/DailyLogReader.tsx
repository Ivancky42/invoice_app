"use client";

import type { DailyLogDTO } from "@/lib/stocks/db";

function splitPipeSegments(body: string | null): string[] {
	if (!body?.trim()) return [];
	const parts = body.split("|").map((s) => s.trim()).filter((s) => s.length > 0);
	return parts.length > 0 ? parts : [body.trim()];
}

/** First `:` divides label/ticker from the rest (`TICKER … : details`) — text before ":" is bold. */
function MoveLine({ segment }: { segment: string }) {
	const colon = segment.indexOf(":");
	if (colon > 0) {
		const label = segment.slice(0, colon);
		const rest = segment.slice(colon);
		return (
			<>
				<strong className="font-semibold text-gray-900">{label}</strong>
				<span>{rest}</span>
			</>
		);
	}
	return <>{segment}</>;
}

function PipeSeparatedMoveBody({ text }: { text: string | null }) {
	if (!text?.trim()) {
		return <p className="text-sm text-emerald-600/45 italic py-1 m-0">Empty</p>;
	}

	const segments = splitPipeSegments(text);
	return (
		<div className="flex flex-col gap-y-6 text-sm leading-relaxed text-gray-900">
			{segments.map((segment, idx) => (
				<p key={idx} className="whitespace-pre-wrap m-0">
					<MoveLine segment={segment} />
				</p>
			))}
		</div>
	);
}

/**
 * Prefer real newlines from Notion; otherwise split inline numbered items "1. … 2. …".
 * List index 1–99 as `\d{N}. ` (digit(s), dot, space) so years like `2026. …` do not split.
 */
const INLINE_NEWS_ENUM_SPLIT =
	/\s+(?=(?:[1-9]|[12]\d|30|3[1-9]|[4-9]\d)\.\s+)/;

function splitTopNewsParagraphs(raw: string | null): string[] {
	if (!raw?.trim()) return [];
	const t = raw.trim();

	const nlBlocks = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
	if (nlBlocks.length > 1) return nlBlocks;

	const chunks = t.split(INLINE_NEWS_ENUM_SPLIT).map((s) => s.trim()).filter(Boolean);
	if (chunks.length > 1) return chunks;

	return [t];
}

function TopNewsBlock({ body }: { body: string | null }) {
	return (
		<div>
			<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Top news</h3>
			{body?.trim() ? (
				<div className="flex flex-col gap-y-5 text-sm leading-relaxed text-gray-800">
					{splitTopNewsParagraphs(body).map((paragraph, idx) => (
						<p key={idx} className="whitespace-pre-wrap font-sans m-0">
							{paragraph}
						</p>
					))}
				</div>
			) : (
				<p className="text-sm text-gray-400 italic">Empty</p>
			)}
		</div>
	);
}

function Block({ title, body }: { title: string; body: string | null }) {
	return (
		<div>
			<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{title}</h3>
			{body ? (
				<pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">{body}</pre>
			) : (
				<p className="text-sm text-gray-400 italic">Empty</p>
			)}
		</div>
	);
}

function MoveCard({ title, body }: { title: string; body: string | null }) {
	return (
		<div className="rounded-xl border border-emerald-100/50 bg-emerald-50/40 px-5 pt-5 pb-6 shadow-sm">
			<h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800/70 mb-4">{title}</h3>
			{body ? (
				<PipeSeparatedMoveBody text={body} />
			) : (
				<p className="text-sm text-emerald-600/45 italic py-1">Empty</p>
			)}
		</div>
	);
}

export function DailyLogReader({ entry }: { entry: DailyLogDTO }) {
	return (
		<article className="space-y-6">
			<header className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-gray-100">
				<div>
					<h2 className="text-xl font-semibold text-gray-900">{entry.title}</h2>
				</div>
				<dl className="flex flex-wrap gap-3 text-sm">
					<div className="rounded-lg bg-gray-50 px-3 py-2">
						<dt className="text-xs text-gray-500">Flags</dt>
						<dd className="font-medium tabular-nums">{entry.flagsCount ?? "—"}</dd>
					</div>
					<div className="rounded-lg bg-gray-50 px-3 py-2">
						<dt className="text-xs text-gray-500">Alert email</dt>
						<dd className="font-medium">
							{entry.alertEmailSent === null ? "—" : entry.alertEmailSent ? "Sent" : "Not sent"}
						</dd>
					</div>
				</dl>
			</header>

			{entry.flaggedTickers ? (
				<section>
					<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Flagged tickers</h3>
					<p className="text-sm text-gray-800 tracking-wide">{entry.flaggedTickers}</p>
				</section>
			) : null}

			<Block title="Market context" body={entry.marketContext} />
			<TopNewsBlock body={entry.topNews} />
			<section className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<MoveCard title="Portfolio move" body={entry.portfolioMove} />
				<MoveCard title="Watchlist move" body={entry.watchlistMove} />
			</section>
			<Block title="Action taken" body={entry.actionTaken} />
			<Block title="Notes" body={entry.notes} />
		</article>
	);
}
