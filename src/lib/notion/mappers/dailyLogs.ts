import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asBoolean, asDate, asString, readPrimaryTitle, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { runInTransactionBatches } from "@/lib/notion/batchTransaction";
import { queryAllPages } from "@/lib/notion/queryAll";
import { toJsonBlocks } from "@/lib/notion/jsonBlocks";

const US_LONG_MONTH_TO_INDEX: Record<string, number> = {
	January: 0,
	February: 1,
	March: 2,
	April: 3,
	May: 4,
	June: 5,
	July: 6,
	August: 7,
	September: 8,
	October: 9,
	November: 10,
	December: 11,
};

function parseTitleLeadingDate(title: string): Date | null {
	const m = /^\s*(\d{4}-\d{2}-\d{2})\b/.exec(title);
	if (!m) return null;
	const d = new Date(`${m[1]}T12:00:00.000Z`);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** "May 12, 2026" embedded in titles like "Daily Scan — May 12, 2026". */
function parseEmbeddedUsLongDate(title: string): Date | null {
	const m =
		/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/.exec(title);
	if (!m) return null;
	const mi = US_LONG_MONTH_TO_INDEX[m[1] as keyof typeof US_LONG_MONTH_TO_INDEX];
	const day = Number.parseInt(m[2], 10);
	const year = Number.parseInt(m[3], 10);
	if (mi === undefined || day < 1 || day > 31) return null;
	const d = new Date(Date.UTC(year, mi, day, 12, 0, 0, 0));
	return Number.isNaN(d.getTime()) ? null : d;
}

/** Split Notion flagged-tickers text into a clean string[]. */
function parseFlaggedTickers(raw: string | null): string[] {
	if (!raw?.trim()) return [];
	const byComma = raw
		.split(/[,;]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	if (byComma.length > 1) return byComma;

	const single = byComma[0] ?? raw.trim();
	// Bare tickers separated only by spaces: "OKLO LUNR ISRG"
	if (/^[A-Z][A-Z0-9.]{0,5}(?:\s+[A-Z][A-Z0-9.]{0,5})+$/.test(single)) {
		return single.split(/\s+/);
	}
	// "TICKER (notes) TICKER (notes)" — split before the next ticker+(
	const withNotes = single
		.split(/(?=\s+[A-Z]{1,6}(?:\.[A-Z]{1,2})?\s*\()/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return withNotes.length > 0 ? withNotes : [single];
}

function mapPage(page: PageObjectResponse): Prisma.DailyLogUncheckedCreateInput | null {
	const title = readPrimaryTitle(page) ?? asString(readProp(page, "Name"));
	if (!title?.trim()) return null;

	const notionDate = asDate(readProp(page, "Date"));
	const logDate = notionDate ?? parseTitleLeadingDate(title) ?? parseEmbeddedUsLongDate(title);

	return {
		notionId: page.id,
		title,
		logDate,
		actionTaken: toJsonBlocks(asString(readProp(page, "Action Taken"))),
		alertEmailSent: asBoolean(readProp(page, "Alert Email Sent")),
		flaggedTickers: parseFlaggedTickers(asString(readProp(page, "Flagged Tickers"))),
		marketContext: toJsonBlocks(asString(readProp(page, "Market Context"))),
		notes: toJsonBlocks(asString(readProp(page, "Notes"))),
		portfolioMove: toJsonBlocks(asString(readProp(page, "Portfolio Move"))),
		topNews: toJsonBlocks(asString(readProp(page, "Top News"))),
		watchlistMove: toJsonBlocks(asString(readProp(page, "Watchlist Move"))),
	};
}

export async function syncDailyLogs(): Promise<{ count: number }> {
	const v = process.env.NOTION_DAILY_LOG_DB?.trim();
	if (!v) return { count: 0 };

	const dbId = notionDbId("NOTION_DAILY_LOG_DB");
	const pages = await queryAllPages(dbId);
	const rows = pages.map(mapPage).filter((r): r is Prisma.DailyLogUncheckedCreateInput => r !== null);

	if (rows.length > 0) {
		await runInTransactionBatches(
			rows.map((r) => {
				const { notionId, ...update } = r;
				if (!notionId) throw new Error("DailyLog sync row missing notionId");
				return prisma.dailyLog.upsert({ where: { notionId }, create: r, update });
			}),
		);
	}

	return { count: rows.length };
}
