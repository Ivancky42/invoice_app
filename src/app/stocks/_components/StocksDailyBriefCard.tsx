import { unstable_noStore as noStore } from "next/cache";
import { StockReportType } from "@/generated/prisma/client";
import {
	dailyLogToDTO,
	getLatestDailyLog,
	getLatestStockReport,
	stockReportToDTO,
} from "@/lib/stocks/db";
import { OverviewBriefsPanel } from "@/app/stocks/_components/OverviewBriefsPanel";

export async function StocksDailyBriefCard() {
	noStore();

	const [daily, weekly, monthly] = await Promise.all([
		getLatestDailyLog(),
		getLatestStockReport(StockReportType.WEEKLY),
		getLatestStockReport(StockReportType.MONTHLY),
	]);

	if (!daily && !weekly && !monthly) return null;

	return (
		<OverviewBriefsPanel
			daily={daily ? dailyLogToDTO(daily) : null}
			weekly={weekly ? stockReportToDTO(weekly) : null}
			monthly={monthly ? stockReportToDTO(monthly) : null}
		/>
	);
}
