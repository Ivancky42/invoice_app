import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asBoolean, asDate, asInt, asString, readPrimaryTitle, readProp } from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { runInTransactionBatches } from "@/lib/notion/batchTransaction";
import { queryAllPages } from "@/lib/notion/queryAll";

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

function mapPage(page: PageObjectResponse): Prisma.DailyLogUncheckedCreateInput | null {
	const title = readPrimaryTitle(page) ?? asString(readProp(page, "Name"));
	if (!title?.trim()) return null;

	const notionDate = asDate(readProp(page, "Date"));
	const logDate = notionDate ?? parseTitleLeadingDate(title) ?? parseEmbeddedUsLongDate(title);

	return {
		notionId: page.id,
		title,
		logDate,
		actionTaken: asString(readProp(page, "Action Taken")),
		alertEmailSent: asBoolean(readProp(page, "Alert Email Sent")),
		flaggedTickers: asString(readProp(page, "Flagged Tickers")),
		flagsCount: asInt(readProp(page, "Flags Count")),
		marketContext: asString(readProp(page, "Market Context")),
		notes: asString(readProp(page, "Notes")),
		portfolioMove: asString(readProp(page, "Portfolio Move")),
		topNews: asString(readProp(page, "Top News")),
		watchlistMove: asString(readProp(page, "Watchlist Move")),
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
			rows.map((r) =>
				prisma.dailyLog.upsert({ where: { notionId: r.notionId }, create: r, update: r }),
			),
		);
	}

	return { count: rows.length };
}
