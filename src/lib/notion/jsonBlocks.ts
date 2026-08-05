import { Prisma } from "@/generated/prisma/client";
import {
	textToBlocksOrNull,
	type ReportBlock,
} from "@/lib/content/blocks";

/** Prisma Json create/update value: blocks or SQL NULL. */
export function toJsonBlocks(
	text: string | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
	const blocks = textToBlocksOrNull(text);
	if (!blocks) return Prisma.DbNull;
	return blocks as unknown as Prisma.InputJsonValue;
}

/** Store an existing block array as Json, or SQL NULL when empty. */
export function blocksToJsonValue(
	blocks: ReportBlock[] | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
	if (!blocks || blocks.length === 0) return Prisma.DbNull;
	return blocks as unknown as Prisma.InputJsonValue;
}
