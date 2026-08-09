export type ReportBlock =
	| { type: "paragraph"; text: string }
	| { type: "heading_1" | "heading_2" | "heading_3"; text: string }
	| { type: "bulleted_list_item"; text: string; children?: ReportBlock[] }
	| { type: "numbered_list_item"; text: string; children?: ReportBlock[] }
	| { type: "quote"; text: string }
	| { type: "callout"; text: string }
	| { type: "divider" }
	| { type: "table"; headers: string[]; rows: string[][] };

const BLOCK_TYPES = new Set([
	"paragraph",
	"heading_1",
	"heading_2",
	"heading_3",
	"bulleted_list_item",
	"numbered_list_item",
	"quote",
	"callout",
	"divider",
	"table",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReportBlock(value: unknown): value is ReportBlock {
	if (!isPlainObject(value) || typeof value.type !== "string") return false;
	if (!BLOCK_TYPES.has(value.type)) return false;
	if (value.type === "divider") return true;
	if (value.type === "table") {
		if (!Array.isArray(value.headers) || !Array.isArray(value.rows)) return false;
		if (!value.headers.every((h): h is string => typeof h === "string")) return false;
		return value.rows.every(
			(row) =>
				Array.isArray(row) && row.every((cell): cell is string => typeof cell === "string"),
		);
	}
	if (typeof value.text !== "string") return false;
	if (
		(value.type === "bulleted_list_item" || value.type === "numbered_list_item") &&
		value.children !== undefined &&
		!isReportBlockArray(value.children)
	) {
		return false;
	}
	return true;
}

export function isReportBlockArray(value: unknown): value is ReportBlock[] {
	return Array.isArray(value) && value.every(isReportBlock);
}

/** Wrap plain text as a single paragraph block (empty → []). */
export function textToBlocks(text: string): ReportBlock[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	return [{ type: "paragraph", text: trimmed }];
}

/** Normalize DB Json / legacy string / null into ReportBlock[]. */
export function asReportBlocks(value: unknown): ReportBlock[] {
	if (value == null) return [];
	if (typeof value === "string") return textToBlocks(value);
	if (isReportBlockArray(value)) return value;
	return [];
}

export function hasReportBlocks(value: unknown): boolean {
	return asReportBlocks(value).length > 0;
}

const MONTH =
	"Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const DOW = "Mon|Tue|Wed|Thu|Fri|Sat|Sun";
/** Date-led ticker-note lines (ISO, "Jun 3, 2026", "Mon Jun 15 2026"). */
const DATE_LED =
	new RegExp(
		`^(?:\\d{4}-\\d{2}-\\d{2}|(?:${DOW})\\s+(?:${MONTH})\\s+\\d{1,2}\\s+\\d{4}|(?:${MONTH})\\s+\\d{1,2},?\\s+\\d{4})\\b`,
	);

function isDateLedEntry(text: string): boolean {
	return DATE_LED.test(text.trimStart());
}

/**
 * Split a paragraph that packs many dated daily notes into one block
 * (legacy Notion / early-agent shape) into one entry per date header.
 */
export function splitDatedNoteText(text: string): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];

	const chunks = trimmed.split(/\n\n+/);
	const entries: string[] = [];
	for (const chunk of chunks) {
		const part = chunk.trim();
		if (!part) continue;
		if (entries.length === 0 || isDateLedEntry(part)) {
			entries.push(part);
		} else {
			entries[entries.length - 1] += `\n\n${part}`;
		}
	}

	// Densely packed single-newline logs: re-split when blank-line split failed
	// to separate date-led lines.
	if (entries.length === 1 && /\n(?=\S)/.test(entries[0]) && isDateLedEntry(entries[0])) {
		const lines = entries[0].split("\n");
		const dense: string[] = [];
		for (const line of lines) {
			const part = line.trimEnd();
			if (!part.trim()) continue;
			if (dense.length === 0 || isDateLedEntry(part)) dense.push(part.trim());
			else dense[dense.length - 1] += `\n${part}`;
		}
		if (dense.length > 1) return dense;
	}

	return entries;
}

/**
 * Expand stored pageNotes into chronological dated entries.
 * Mega-paragraphs that contain many "YYYY-MM-DD" / "Mon Jun 15 2026" headers
 * become one entry each; non-paragraph blocks pass through unchanged.
 */
export function expandPageNoteEntries(blocks: ReportBlock[]): ReportBlock[] {
	const out: ReportBlock[] = [];
	for (const block of blocks) {
		if (
			block.type === "paragraph" ||
			block.type === "quote" ||
			block.type === "callout"
		) {
			const parts = splitDatedNoteText(block.text);
			if (parts.length <= 1) {
				out.push(block);
				continue;
			}
			for (const text of parts) {
				out.push({ type: "paragraph", text });
			}
			continue;
		}
		out.push(block);
	}
	return out;
}

/** Default char budget for context/list pageNotes previews (~keeps MCP under limit). */
export const PAGE_NOTES_PREVIEW_MAX_CHARS = 4_500;

/**
 * Keep the newest `keep` dated entries for context/list payloads, with a
 * char budget so legacy mega-blocks cannot blow the response.
 * Full history remains in DB; use get_page_notes for older entries.
 */
export function truncatePageNotes(
	value: unknown,
	keep = 3,
	maxChars = PAGE_NOTES_PREVIEW_MAX_CHARS,
): { blocks: ReportBlock[]; totalBlocks: number; truncated: boolean } {
	const raw = asReportBlocks(value);
	const all = expandPageNoteEntries(raw);
	if (all.length === 0) {
		return { blocks: [], totalBlocks: 0, truncated: false };
	}

	let kept = all.length <= keep ? all : all.slice(-keep);
	// Truncated only when the preview drops entries (or char-budget slices one).
	// Expanding a mega-block without dropping is not truncation.
	let truncated = all.length > kept.length;

	// Char budget: drop oldest kept entries first; if one entry still overflows,
	// keep only its tail (newest text inside the entry).
	const textLen = (blocks: ReportBlock[]) =>
		blocks.reduce((n, b) => n + ("text" in b && typeof b.text === "string" ? b.text.length : 40), 0);

	while (kept.length > 1 && textLen(kept) > maxChars) {
		kept = kept.slice(1);
		truncated = true;
	}
	if (kept.length === 1 && textLen(kept) > maxChars) {
		const only = kept[0];
		if ("text" in only && typeof only.text === "string") {
			const text = only.text;
			const slice = text.slice(-maxChars);
			const snapped = slice.replace(/^[^\n]*\n/, "") || slice;
			kept = [{ type: "paragraph", text: `…${snapped}` }];
			truncated = true;
		}
	}

	return {
		blocks: kept,
		totalBlocks: all.length,
		truncated,
	};
}

function blockToPlainText(block: ReportBlock): string {
	switch (block.type) {
		case "paragraph":
		case "heading_1":
		case "heading_2":
		case "heading_3":
		case "quote":
		case "callout":
			return block.text.trim();
		case "bulleted_list_item":
		case "numbered_list_item": {
			const prefix = block.type === "bulleted_list_item" ? "- " : "1. ";
			const nested =
				block.children?.map(blockToPlainText).filter(Boolean).join("\n") ?? "";
			return `${prefix}${block.text.trim()}${nested ? `\n${nested}` : ""}`;
		}
		case "divider":
			return "---";
		case "table": {
			const lines = [
				block.headers.length > 0 ? block.headers.join(" | ") : null,
				...block.rows.map((row) => row.join(" | ")),
			].filter(Boolean);
			return lines.join("\n");
		}
		default:
			return "";
	}
}

/** Flatten normalized blocks into plain text. */
export function blocksToPlainText(blocks: ReportBlock[]): string {
	return blocks
		.map(blockToPlainText)
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

/** Notion string → Json-ready blocks, or null when empty. */
export function textToBlocksOrNull(text: string | null | undefined): ReportBlock[] | null {
	if (!text?.trim()) return null;
	return textToBlocks(text);
}
