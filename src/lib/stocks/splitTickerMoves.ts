/**
 * Split dense agent move paragraphs into one line per ticker.
 * Handles: `VST $197 ⚠️ -8.1% … DDOG $134 (−$5, −3.8%) …`
 * and already-newline / pipe-separated lists.
 */

const TICKER_PRICE_START =
	/\b(?=[A-Z]{1,5}(?:_USD)?\s*\$[\d,.]+)/g;

const LOOKS_LIKE_TICKER_LINE =
	/\b[A-Z]{1,5}(?:_USD)?\b(?:\s*\$|\s+[⚠️↑↓+\-−]|\s+\()/;

export function looksLikeTickerLine(line: string): boolean {
	return LOOKS_LIKE_TICKER_LINE.test(line.trim());
}

/** Returns null when the text should stay a single paragraph. */
export function splitTickerMoveLines(text: string): string[] | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const softLines = trimmed
		.split(/\n+/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (softLines.length >= 2) {
		const tickerish = softLines.filter(looksLikeTickerLine);
		if (tickerish.length >= 2) return softLines;
	}

	// Pipe-separated ticker blobs (less common).
	if (trimmed.includes("|") && (trimmed.match(TICKER_PRICE_START) ?? []).length >= 2) {
		const pipeParts = trimmed
			.split(/\s*\|\s*/)
			.map((p) => p.trim())
			.filter(Boolean);
		if (pipeParts.length >= 2 && pipeParts.filter(looksLikeTickerLine).length >= 2) {
			return pipeParts;
		}
	}

	const starts = [...trimmed.matchAll(TICKER_PRICE_START)].map((m) => m.index ?? 0);
	if (starts.length < 2) return null;

	const parts: string[] = [];
	for (let i = 0; i < starts.length; i++) {
		const from = starts[i]!;
		const to = i + 1 < starts.length ? starts[i + 1]! : trimmed.length;
		const chunk = trimmed.slice(from, to).trim();
		if (chunk) parts.push(chunk);
	}

	// Leading preamble before first ticker (rare) — keep as its own line.
	if (starts[0]! > 0) {
		const preamble = trimmed.slice(0, starts[0]).trim();
		if (preamble) parts.unshift(preamble);
	}

	return parts.length >= 2 ? parts : null;
}

export type FlaggedGroup = {
	label: string | null;
	tone: "up" | "down" | "neutral";
	items: { ticker: string; detail: string }[];
};

const FLAG_ITEM =
	/\b([A-Z]{1,5}(?:_USD)?)\b\s*([+\-−↑↓]?\s*[+\-−]?\d+(?:\.\d+)?%?)/g;

/**
 * Parse flaggedTickers array — may be discrete items or one "UP: … | DOWN: …" blob.
 */
export function parseFlaggedTickers(raw: string[]): FlaggedGroup[] {
	const joined = raw.map((s) => s.trim()).filter(Boolean);
	if (joined.length === 0) return [];

	const blob = joined.join(" | ");
	const hasGroups = /\bUP\s*:/i.test(blob) || /\bDOWN\s*:/i.test(blob);

	if (hasGroups) {
		const groups: FlaggedGroup[] = [];
		const upMatch = blob.match(/\bUP\s*:\s*([^|]+?)(?=\s*\|\s*DOWN\s*:|$)/i);
		const downMatch = blob.match(/\bDOWN\s*:\s*(.+)$/i);
		if (upMatch?.[1]) {
			groups.push({ label: "Up", tone: "up", items: extractFlagItems(upMatch[1]) });
		}
		if (downMatch?.[1]) {
			groups.push({ label: "Down", tone: "down", items: extractFlagItems(downMatch[1]) });
		}
		if (groups.some((g) => g.items.length > 0)) return groups;
	}

	// Discrete array entries: "MRVL +12.8" or just "MRVL"
	const items = joined.flatMap((s) => {
		const extracted = extractFlagItems(s);
		if (extracted.length > 0) return extracted;
		const t = s.match(/\b([A-Z]{1,5}(?:_USD)?)\b/);
		return t ? [{ ticker: t[1]!, detail: s.replace(t[0], "").trim() }] : [];
	});

	if (items.length === 0) {
		return [{ label: null, tone: "neutral", items: joined.map((s) => ({ ticker: s, detail: "" })) }];
	}

	const up: FlaggedGroup["items"] = [];
	const down: FlaggedGroup["items"] = [];
	const other: FlaggedGroup["items"] = [];
	for (const it of items) {
		const d = it.detail.replace(/\u2212/g, "-");
		if (/^\s*[+\u2191]/.test(d) || /↑/.test(d)) up.push(it);
		else if (/^\s*[-−\u2193]/.test(d) || /↓/.test(d) || /^-\d/.test(d.trim())) down.push(it);
		else other.push(it);
	}

	const out: FlaggedGroup[] = [];
	if (up.length) out.push({ label: "Up", tone: "up", items: up });
	if (down.length) out.push({ label: "Down", tone: "down", items: down });
	if (other.length) out.push({ label: out.length ? "Other" : null, tone: "neutral", items: other });
	return out;
}

function extractFlagItems(text: string): { ticker: string; detail: string }[] {
	const items: { ticker: string; detail: string }[] = [];
	const re = new RegExp(FLAG_ITEM.source, "g");
	for (const m of text.matchAll(re)) {
		items.push({ ticker: m[1]!, detail: (m[2] ?? "").replace(/\s+/g, "").trim() });
	}
	return items;
}
