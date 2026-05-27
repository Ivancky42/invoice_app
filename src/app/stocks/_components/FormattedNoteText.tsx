import type { ReactNode } from "react";

/**
 * Parenthetical price-move clauses, e.g.
 * `(↑+3.4% from $28.65)`, `(↓-0.5% from $1,043.82)`, `(+$3.16, +3.8%)`, `(-0.5%)`,
 * `(flat — prices reflect May 22 close; first trading day post-Memorial Day)`.
 */
const PRICE_MOVE =
	/\((?:flat\s*[—–-][^)]*|[↑↓]\s*[+-][\d.]+%[^)]*|[+-]\$[\d,.]+(?:,\s*[+-][\d.]+%)?[^)]*|[+-][\d.]+%[^)]*)\)/gi;

type MoveTone = "up" | "down" | "flat";

function classifyMove(segment: string): MoveTone {
	if (/^\(flat\b/i.test(segment)) return "flat";
	if (segment.includes("↓")) return "down";
	if (segment.includes("↑")) return "up";
	if (/\(-[\d.]/.test(segment) || /\(-\$/.test(segment)) return "down";
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

function formatNoteText(text: string): ReactNode[] {
	const parts: { type: "text" | "move"; value: string }[] = [];
	let last = 0;

	for (const match of text.matchAll(PRICE_MOVE)) {
		const idx = match.index ?? 0;
		if (idx > last) parts.push({ type: "text", value: text.slice(last, idx) });
		parts.push({ type: "move", value: match[0] });
		last = idx + match[0].length;
	}

	if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
	if (parts.length === 0) return [text];

	return parts.map((part, index) =>
		part.type === "move" ? (
			<span key={index} className={moveClassName(classifyMove(part.value))}>
				{part.value}
			</span>
		) : (
			<span key={index}>{part.value}</span>
		),
	);
}

export function FormattedNoteText({ text }: { text: string }) {
	return <span className="whitespace-pre-wrap">{formatNoteText(text)}</span>;
}
