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
