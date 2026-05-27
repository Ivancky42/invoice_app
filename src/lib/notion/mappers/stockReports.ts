import type { Prisma } from "@/generated/prisma/client";
import { StockReportType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchPageBlocks, listChildPages } from "@/lib/notion/blocks";

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

function classifyReport(title: string): StockReportType | null {
	if (/weekly stock report/i.test(title)) return StockReportType.WEEKLY;
	if (/monthly macro trend/i.test(title)) return StockReportType.MONTHLY;
	return null;
}

/** "May 24, 2026" in titles like "Weekly Stock Report — May 24, 2026". */
function parseWeeklyDate(title: string): Date | null {
	const m =
		/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/.exec(
			title,
		);
	if (!m) return null;
	const mi = US_LONG_MONTH_TO_INDEX[m[1] as keyof typeof US_LONG_MONTH_TO_INDEX];
	const day = Number.parseInt(m[2], 10);
	const year = Number.parseInt(m[3], 10);
	if (mi === undefined || day < 1 || day > 31) return null;
	const d = new Date(Date.UTC(year, mi, day, 12, 0, 0, 0));
	return Number.isNaN(d.getTime()) ? null : d;
}

/** "May 2026" in titles like "Monthly Macro Trend Survey — May 2026". */
function parseMonthlyDate(title: string): Date | null {
	const m =
		/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/.exec(
			title,
		);
	if (!m) return null;
	const mi = US_LONG_MONTH_TO_INDEX[m[1] as keyof typeof US_LONG_MONTH_TO_INDEX];
	const year = Number.parseInt(m[2], 10);
	if (mi === undefined) return null;
	const d = new Date(Date.UTC(year, mi, 1, 12, 0, 0, 0));
	return Number.isNaN(d.getTime()) ? null : d;
}

function parseReportDate(title: string, type: StockReportType): Date | null {
	return type === StockReportType.WEEKLY ? parseWeeklyDate(title) : parseMonthlyDate(title);
}

export async function syncStockReports(): Promise<{ count: number }> {
	const hqId = process.env.NOTION_STOCK_HQ_PAGE_ID?.trim();
	if (!hqId) return { count: 0 };

	const children = await listChildPages(hqId);
	const reportPages = children.filter((p) => classifyReport(p.title) !== null);

	const rows: Prisma.StockReportUncheckedCreateInput[] = [];
	for (const page of reportPages) {
		const reportType = classifyReport(page.title)!;
		const content = await fetchPageBlocks(page.id);
		rows.push({
			notionId: page.id,
			title: page.title,
			reportType,
			reportDate: parseReportDate(page.title, reportType),
			content: content as Prisma.InputJsonValue,
		});
	}

	if (rows.length > 0) {
		await prisma.$transaction(
			rows.map((r) =>
				prisma.stockReport.upsert({ where: { notionId: r.notionId }, create: r, update: r }),
			),
		);
	}

	return { count: rows.length };
}
