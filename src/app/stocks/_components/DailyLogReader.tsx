"use client";

import type { ReactNode } from "react";
import type { DailyLogDTO } from "@/lib/stocks/db";

function splitPipeSegments(body: string | null): string[] {
	if (!body?.trim()) return [];
	const parts = body
		.split("|")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return parts.length > 0 ? parts : [body.trim()];
}

/**
 * Pipe-separated moves often look like:
 * `GEV $1,090.53 | bullet one | bullet two | ISRG $428.06 | …`
 * A new ticker row starts when a segment begins with TICKER + `$` (optional `.` class, e.g. BRK.B).
 */
const TICKER_PRICE_HEADLINE = /^[A-Z]{1,6}(?:\.[A-Z]{1,2})?\s+\$/;

/**
 * Inline scan lines often look like:
 * `GEV +6.6% → $1,174.86 details…). DDOG +4.7% → $260.36, …`
 * or `OPRA flat $19.83 WATCH (…).`
 * Supports `+`/`-`/`−` (unicode minus) before the percent.
 */
const TICKER_PCT_MOVE_SEGMENT =
	/^([A-Z]{1,6}(?:\.[A-Z]{1,2})?)\s+([+\u2212-][\d.]+%)\s*→\s*(\$[\d,]+(?:\.\d+)?)([\s\S]*)$/;

const TICKER_FLAT_MOVE_SEGMENT =
	/^([A-Z]{1,6}(?:\.[A-Z]{1,2})?)\s+flat\s+(\$[\d,]+(?:\.\d+)?)([\s\S]*)$/;

/** Inline ticker head after start-of-text or `. `. */
const INLINE_TICKER_HEAD =
	/(?:^|(?<=\.\s))([A-Z]{1,6}(?:\.[A-Z]{1,2})?)\s+(?:[+\u2212-][\d.]+%\s*→\s*\$[\d,]+(?:\.\d+)?|flat\s+\$[\d,]+(?:\.\d+)?)/g;

type InlineTickerBlock = {
	symbol: string;
	changeLabel: string;
	price: string;
	details: string;
};

type ParsedInlineTickerMoves = {
	blocks: InlineTickerBlock[];
	footnote: string | null;
};

function cleanInlineTickerDetails(raw: string): string {
	return raw.trim().replace(/^,\s*/, "").replace(/\.$/, "").trim();
}

function parseInlineTickerSegment(segment: string): InlineTickerBlock | null {
	const trimmed = segment.trim();
	const pct = trimmed.match(TICKER_PCT_MOVE_SEGMENT);
	if (pct) {
		return {
			symbol: pct[1],
			changeLabel: pct[2],
			price: pct[3],
			details: cleanInlineTickerDetails(pct[4]),
		};
	}
	const flat = trimmed.match(TICKER_FLAT_MOVE_SEGMENT);
	if (flat) {
		return {
			symbol: flat[1],
			changeLabel: "flat",
			price: flat[2],
			details: cleanInlineTickerDetails(flat[3]),
		};
	}
	return null;
}

/** Closing summary after the last ticker, e.g. "No promotions, demotions, or BUY signals today." */
function peelTrailingFootnote(segment: string): {
	segment: string;
	footnote: string | null;
} {
	const m = /\.\s+(No\s+[A-Za-z][\s\S]*)$/.exec(segment.trim());
	if (!m) return { segment, footnote: null };
	return {
		segment: segment.trim().slice(0, m.index).trim(),
		footnote: m[1].trim().replace(/\.$/, "").trim(),
	};
}

function parseInlineTickerMoves(body: string): ParsedInlineTickerMoves | null {
	const trimmed = body.trim();
	if (!trimmed) return null;

	const lines = trimmed.split(/\n+/).map((l) => l.trim()).filter(Boolean);
	if (lines.length > 1) {
		const fromLines = lines.map(parseInlineTickerSegment);
		if (fromLines.every((b): b is InlineTickerBlock => b !== null)) {
			return { blocks: fromLines, footnote: null };
		}
	}

	const headMatches = [...trimmed.matchAll(INLINE_TICKER_HEAD)];
	if (headMatches.length === 0) return null;

	const starts = headMatches
		.map((match) => match.index)
		.filter((index): index is number => index !== undefined);

	const blocks: InlineTickerBlock[] = [];
	let footnote: string | null = null;

	for (let i = 0; i < starts.length; i++) {
		let segment = trimmed.slice(starts[i], starts[i + 1] ?? trimmed.length).trim();
		if (i === starts.length - 1) {
			const peeled = peelTrailingFootnote(segment);
			segment = peeled.segment;
			footnote = peeled.footnote;
		}
		const block = parseInlineTickerSegment(segment);
		if (!block) return null;
		blocks.push(block);
	}

	return blocks.length > 0 ? { blocks, footnote } : null;
}

function changeLabelTone(changeLabel: string): "up" | "down" | "flat" {
	if (changeLabel === "flat") return "flat";
	return changeLabel.trim().startsWith("+") ? "up" : "down";
}

function parseMoveBodyIntoTickerBlocks(
	body: string,
): { headline: string; bullets: string[] }[] | null {
	const segments = splitPipeSegments(body);
	if (segments.length === 0) return null;

	const blocks: { headline: string; bullets: string[] }[] = [];
	let current: { headline: string; bullets: string[] } | null = null;

	for (const segment of segments) {
		if (TICKER_PRICE_HEADLINE.test(segment)) {
			if (current) blocks.push(current);
			current = { headline: segment, bullets: [] };
		} else if (current) {
			current.bullets.push(segment);
		} else {
			return null;
		}
	}

	if (current) blocks.push(current);
	return blocks.length > 0 ? blocks : null;
}

/** Split `SYM $123.45` into symbol + price for the headline row (fallback: whole string). */
const TICKER_PRICE_SPLIT = /^([A-Z]{1,6}(?:\.[A-Z]{1,2})?)\s+(\$\s*.+)$/;

function MoveTickerHeadline({ headline }: { headline: string }) {
	const m = headline.match(TICKER_PRICE_SPLIT);
	if (!m) {
		return (
			<span className="font-semibold tracking-wide text-gray-900">
				{headline}
			</span>
		);
	}
	const [, symbol, price] = m;
	return (
		<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
			<span className="font-semibold tracking-wide text-gray-900">
				{symbol}
			</span>
			<span className="tabular-nums font-medium text-emerald-900/90">
				{price.replace(/\s+/g, " ").trim()}
			</span>
		</div>
	);
}

function InlineTickerMoveHeadline({ block }: { block: InlineTickerBlock }) {
	const tone = changeLabelTone(block.changeLabel);
	const labelClass =
		tone === "up"
			? "text-emerald-600"
			: tone === "down"
				? "text-red-600"
				: "text-gray-500";

	return (
		<div>
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
				<span className="font-semibold tracking-wide text-gray-900">
					{block.symbol}
				</span>
				<span className={`tabular-nums font-semibold ${labelClass}`}>
					{block.changeLabel}
				</span>
				{tone !== "flat" ? (
					<span className="text-gray-400" aria-hidden>
						→
					</span>
				) : null}
				<span className="tabular-nums font-medium text-gray-900">
					{block.price}
				</span>
			</div>
			{block.details ? (
				<p className="m-0 mt-2 text-sm leading-snug text-gray-800 whitespace-pre-wrap">
					{block.details}
				</p>
			) : null}
		</div>
	);
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
		return (
			<p className="text-sm text-emerald-600/45 italic py-1 m-0">Empty</p>
		);
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

function TickerMoveCard({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<div className="rounded-lg border border-emerald-200/70 bg-white/55 px-3 py-3 shadow-sm text-sm leading-snug">
			{children}
		</div>
	);
}

/** When body matches `TICKER $price | … | TICKER $price | …`, render one card per ticker with bullet points. */
function TickerGroupedMoveBody({ text }: { text: string }) {
	const pipeBlocks = parseMoveBodyIntoTickerBlocks(text);
	if (pipeBlocks) {
		return (
			<div className="flex flex-col gap-4">
				{pipeBlocks.map((block, idx) => (
					<TickerMoveCard key={`${block.headline}-${idx}`}>
						<MoveTickerHeadline headline={block.headline} />
						{block.bullets.length > 0 ? (
							<ul className="m-0 mt-2.5 space-y-1.5 border-t border-emerald-100/80 pt-2.5 p-0 text-sm leading-snug text-gray-800 list-none">
								{block.bullets.map((bullet, j) => (
									<li key={j} className="flex gap-2">
										<span
											className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-600/55"
											aria-hidden
										/>
										<span className="min-w-0 whitespace-pre-wrap">
											<MoveLine segment={bullet} />
										</span>
									</li>
								))}
							</ul>
						) : null}
					</TickerMoveCard>
				))}
			</div>
		);
	}

	const inlineParsed = parseInlineTickerMoves(text);
	if (inlineParsed) {
		return (
			<div className="flex flex-col gap-4">
				{inlineParsed.blocks.map((block, idx) => (
					<TickerMoveCard key={`${block.symbol}-${idx}`}>
						<InlineTickerMoveHeadline block={block} />
					</TickerMoveCard>
				))}
				{inlineParsed.footnote ? (
					<p className="m-0 pt-1 text-sm leading-relaxed text-gray-600 italic border-t border-emerald-100/80">
						{inlineParsed.footnote}
					</p>
				) : null}
			</div>
		);
	}

	return <PipeSeparatedMoveBody text={text} />;
}

/**
 * Prefer real newlines from Notion; otherwise split inline numbered items "1. … 2. …".
 * List index 1–99 as `\d{N}. ` (digit(s), dot, space) so years like `2026. …` do not split.
 */
const INLINE_NEWS_ENUM_SPLIT = /\s+(?=(?:[1-9]|[12]\d|30|3[1-9]|[4-9]\d)\.\s+)/;

function splitTopNewsParagraphs(raw: string | null): string[] {
	if (!raw?.trim()) return [];
	const t = raw.trim();

	const nlBlocks = t
		.split(/\n+/)
		.map((s) => s.trim())
		.filter(Boolean);
	if (nlBlocks.length > 1) return nlBlocks;

	const chunks = t
		.split(INLINE_NEWS_ENUM_SPLIT)
		.map((s) => s.trim())
		.filter(Boolean);
	if (chunks.length > 1) return chunks;

	return [t];
}

function TopNewsBlock({ body }: { body: string | null }) {
	return (
		<div>
			<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
				Top news
			</h3>
			{body?.trim() ? (
				<div className="flex flex-col gap-y-5 text-sm leading-relaxed text-gray-800">
					{splitTopNewsParagraphs(body).map((paragraph, idx) => (
						<p
							key={idx}
							className="whitespace-pre-wrap font-sans m-0"
						>
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
			<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
				{title}
			</h3>
			{body ? (
				<pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
					{body}
				</pre>
			) : (
				<p className="text-sm text-gray-400 italic">Empty</p>
			)}
		</div>
	);
}

function MoveCard({ title, body }: { title: string; body: string | null }) {
	return (
		<div className="rounded-xl border border-emerald-100/50 bg-emerald-50/40 px-5 pt-5 pb-6 shadow-sm">
			<h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800/70 mb-4">
				{title}
			</h3>
			{body ? (
				<TickerGroupedMoveBody text={body} />
			) : (
				<p className="text-sm text-emerald-600/45 italic py-1">Empty</p>
			)}
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
						<dd className="font-medium tabular-nums">
							{entry.flagsCount ?? "—"}
						</dd>
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
				</dl>
			</header>

			{entry.flaggedTickers ? (
				<section>
					<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
						Flagged tickers
					</h3>
					<p className="text-sm text-gray-800 tracking-wide">
						{entry.flaggedTickers}
					</p>
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
