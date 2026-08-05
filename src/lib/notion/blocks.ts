import type { BlockObjectResponse } from "@notionhq/client";
import { notionClient } from "@/lib/notion/client";
import {
	blocksToPlainText,
	type ReportBlock,
} from "@/lib/content/blocks";

export type { ReportBlock } from "@/lib/content/blocks";
export { blocksToPlainText } from "@/lib/content/blocks";

function richText(arr: { plain_text: string }[] | undefined): string {
	return (arr ?? []).map((t) => t.plain_text).join("");
}

async function fetchBlockChildren(blockId: string): Promise<BlockObjectResponse[]> {
	const client = notionClient();
	const out: BlockObjectResponse[] = [];
	let cursor: string | undefined;
	do {
		const res = await client.blocks.children.list({
			block_id: blockId,
			start_cursor: cursor,
			page_size: 100,
		});
		out.push(...(res.results as BlockObjectResponse[]));
		cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
	} while (cursor);
	return out;
}

async function normalizeTable(block: BlockObjectResponse): Promise<ReportBlock | null> {
	if (block.type !== "table") return null;
	const rows = await fetchBlockChildren(block.id);
	const parsed: string[][] = [];
	for (const row of rows) {
		if (row.type !== "table_row") continue;
		parsed.push(row.table_row.cells.map((cell) => richText(cell)));
	}
	if (parsed.length === 0) return null;
	const hasHeader = block.table.has_column_header;
	return {
		type: "table",
		headers: hasHeader ? parsed[0] : [],
		rows: hasHeader ? parsed.slice(1) : parsed,
	};
}

async function normalizeListItem(
	block: BlockObjectResponse,
): Promise<ReportBlock | null> {
	if (block.type === "bulleted_list_item") {
		const text = richText(block.bulleted_list_item.rich_text);
		let children: ReportBlock[] | undefined;
		if (block.has_children) {
			const nested = await fetchBlockChildren(block.id);
			children = [];
			for (const child of nested) {
				const n = await normalizeBlock(child);
				if (n) children.push(n);
			}
			if (children.length === 0) children = undefined;
		}
		return { type: "bulleted_list_item", text, children };
	}
	if (block.type === "numbered_list_item") {
		const text = richText(block.numbered_list_item.rich_text);
		let children: ReportBlock[] | undefined;
		if (block.has_children) {
			const nested = await fetchBlockChildren(block.id);
			children = [];
			for (const child of nested) {
				const n = await normalizeBlock(child);
				if (n) children.push(n);
			}
			if (children.length === 0) children = undefined;
		}
		return { type: "numbered_list_item", text, children };
	}
	return null;
}

async function normalizeBlock(block: BlockObjectResponse): Promise<ReportBlock | null> {
	switch (block.type) {
		case "paragraph":
			return { type: "paragraph", text: richText(block.paragraph.rich_text) };
		case "heading_1":
			return { type: "heading_1", text: richText(block.heading_1.rich_text) };
		case "heading_2":
			return { type: "heading_2", text: richText(block.heading_2.rich_text) };
		case "heading_3":
			return { type: "heading_3", text: richText(block.heading_3.rich_text) };
		case "quote":
			return { type: "quote", text: richText(block.quote.rich_text) };
		case "callout":
			return { type: "callout", text: richText(block.callout.rich_text) };
		case "divider":
			return { type: "divider" };
		case "bulleted_list_item":
		case "numbered_list_item":
			return normalizeListItem(block);
		case "table":
			return normalizeTable(block);
		default:
			return null;
	}
}

/** Fetch and normalize all top-level blocks on a Notion page. */
export async function fetchPageBlocks(pageId: string): Promise<ReportBlock[]> {
	const blocks = await fetchBlockChildren(pageId);
	const out: ReportBlock[] = [];
	for (const block of blocks) {
		const normalized = await normalizeBlock(block);
		if (normalized) out.push(normalized);
	}
	return out;
}

/** Fetch page body as plain text (empty string if no content). */
export async function fetchPageBodyText(pageId: string): Promise<string> {
	const blocks = await fetchPageBlocks(pageId);
	return blocksToPlainText(blocks);
}

export type HqChildPage = { id: string; title: string };

/** List child_page blocks under a Notion page (e.g. Stock Monitor HQ). */
export async function listChildPages(parentPageId: string): Promise<HqChildPage[]> {
	const blocks = await fetchBlockChildren(parentPageId);
	return blocks
		.filter((b): b is BlockObjectResponse & { type: "child_page" } => b.type === "child_page")
		.map((b) => ({ id: b.id, title: b.child_page.title }));
}
