import type { ReactNode } from "react";

/**
 * Highlight price-move / pct / dollar-delta fragments and standalone $prices in notes.
 * Agents must not invent emoji statuses, but notes still use ↑↓, unicode −, pipes, and parens.
 */
const MOVE_TOKEN =
	/(?:\((?:flat\s*[—–-][^)]*|[↑↓]\s*[+\-−][\d.]+%[^)]*|[+\-−]\$[\d,.]+(?:,\s*[+\-−][\d.]+%)?[^)]*|[+\-−][\d.]+%[^)]*)\)|(?:^|[\s|])(?:⚠️\s*)?[↑↓]?\s*[+\-−]\$?[\d,.]+%(?:\s+from\s+\$[\d,.]+)?(?=[\s|;,]|$))/gi;

const PRICE_TOKEN = /\$[\d,]+(?:\.\d{1,4})?/g;

type MoveTone = "up" | "down" | "flat";

function normalizeMinus(s: string): string {
	return s.replace(/\u2212/g, "-").replace(/\u2013/g, "-");
}

function classifyMove(segment: string): MoveTone {
	const s = normalizeMinus(segment);
	if (/\bflat\b/i.test(s)) return "flat";
	if (s.includes("↓")) return "down";
	if (s.includes("↑")) return "up";
	if (/[(\s|]-\$?[\d.]/.test(s) || /-\d/.test(s)) return "down";
	return "up";
}

function moveClassName(tone: MoveTone): string {
	switch (tone) {
		case "up":
			return "font-semibold tabular-nums text-emerald-700";
		case "down":
			return "font-semibold tabular-nums text-red-700";
		case "flat":
			return "font-semibold text-gray-600";
	}
}

/** Highlight standalone tickers like `DDOG` / `CASH_USD` when bordered by punctuation/space. */
const TICKER_TOKEN =
	/\b([A-Z]{1,5}(?:_USD)?)\b(?=\s*\$|\s*\||\s*[—(⚠️↑↓+\-−]|\s+[+\-−↑↓]|\s*$)/g;

function pushPriceAndTickerSpans(
	chunk: string,
	keyPrefix: string,
	out: ReactNode[],
) {
	let last = 0;
	const priceMatches = [...chunk.matchAll(PRICE_TOKEN)];
	const segments: { start: number; end: number; kind: "price" | "text" }[] = [];
	for (const pm of priceMatches) {
		const idx = pm.index ?? 0;
		if (idx > last) segments.push({ start: last, end: idx, kind: "text" });
		segments.push({ start: idx, end: idx + pm[0].length, kind: "price" });
		last = idx + pm[0].length;
	}
	if (last < chunk.length) segments.push({ start: last, end: chunk.length, kind: "text" });
	if (segments.length === 0) segments.push({ start: 0, end: chunk.length, kind: "text" });

	segments.forEach((seg, si) => {
		const value = chunk.slice(seg.start, seg.end);
		if (seg.kind === "price") {
			out.push(
				<span
					key={`${keyPrefix}-p-${si}`}
					className="font-medium tabular-nums text-gray-900"
				>
					{value}
				</span>,
			);
			return;
		}
		let tLast = 0;
		for (const tm of value.matchAll(TICKER_TOKEN)) {
			const tIdx = tm.index ?? 0;
			if (tIdx > tLast) {
				out.push(
					<span key={`${keyPrefix}-t-${si}-${tLast}`}>{value.slice(tLast, tIdx)}</span>,
				);
			}
			out.push(
				<span
					key={`${keyPrefix}-tk-${si}-${tIdx}`}
					className="font-semibold tracking-wide text-gray-900 tabular-nums"
				>
					{tm[1]}
				</span>,
			);
			tLast = tIdx + tm[0].length;
		}
		if (tLast < value.length) {
			out.push(<span key={`${keyPrefix}-t-${si}-end`}>{value.slice(tLast)}</span>);
		}
	});
}

function formatNoteText(text: string): ReactNode[] {
	const parts: { type: "text" | "move"; value: string }[] = [];
	let last = 0;
	const moveMatches = [...text.matchAll(MOVE_TOKEN)];

	for (const match of moveMatches) {
		const idx = match.index ?? 0;
		if (idx > last) parts.push({ type: "text", value: text.slice(last, idx) });
		parts.push({ type: "move", value: match[0] });
		last = idx + match[0].length;
	}
	if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
	if (parts.length === 0) parts.push({ type: "text", value: text });

	const out: ReactNode[] = [];
	parts.forEach((part, index) => {
		if (part.type === "move") {
			out.push(
				<span key={`m-${index}`} className={moveClassName(classifyMove(part.value))}>
					{part.value}
				</span>,
			);
			return;
		}
		pushPriceAndTickerSpans(part.value, `s-${index}`, out);
	});

	return out.length > 0 ? out : [text];
}

export function FormattedNoteText({ text }: { text: string }) {
	return <span className="whitespace-pre-wrap">{formatNoteText(text)}</span>;
}
