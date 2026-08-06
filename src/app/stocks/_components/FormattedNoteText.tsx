import type { ReactNode } from "react";

/**
 * Highlight price-move / pct / dollar-delta fragments in agent & synced notes.
 * Agents must not invent emoji statuses, but notes still use ↑↓, unicode −, pipes, and parens.
 */
const MOVE_TOKEN =
	/(?:\((?:flat\s*[—–-][^)]*|[↑↓]\s*[+\-−][\d.]+%[^)]*|[+\-−]\$[\d,.]+(?:,\s*[+\-−][\d.]+%)?[^)]*|[+\-−][\d.]+%[^)]*)\)|(?:^|[\s|])(?:⚠️\s*)?[↑↓]?\s*[+\-−]\$?[\d,.]+%(?:\s+from\s+\$[\d,.]+)?(?=[\s|;,]|$))/gi;

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
const TICKER_TOKEN = /\b([A-Z]{1,5}(?:_USD)?)\b(?=\s*\$|\s*\||\s*[—(]|$)/g;

function formatNoteText(text: string): ReactNode[] {
	const parts: { type: "text" | "move" | "ticker"; value: string }[] = [];
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
		let tLast = 0;
		const chunk = part.value;
		for (const tm of chunk.matchAll(TICKER_TOKEN)) {
			const tIdx = tm.index ?? 0;
			if (tIdx > tLast) {
				out.push(<span key={`t-${index}-${tLast}`}>{chunk.slice(tLast, tIdx)}</span>);
			}
			out.push(
				<span
					key={`tk-${index}-${tIdx}`}
					className="font-semibold tracking-wide text-gray-900 tabular-nums"
				>
					{tm[1]}
				</span>,
			);
			tLast = tIdx + tm[0].length;
		}
		if (tLast < chunk.length) {
			out.push(<span key={`t-${index}-end`}>{chunk.slice(tLast)}</span>);
		}
	});

	return out.length > 0 ? out : [text];
}

export function FormattedNoteText({ text }: { text: string }) {
	return <span className="whitespace-pre-wrap">{formatNoteText(text)}</span>;
}
