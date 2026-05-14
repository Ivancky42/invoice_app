import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { getLatestDailyLog, dailyLogToDTO } from "@/lib/stocks/db";
import { DailyLogReader } from "@/app/stocks/_components/DailyLogReader";

export async function StocksDailyBriefCard() {
	noStore();

	const latest = await getLatestDailyLog();
	if (!latest) return null;

	const dto = dailyLogToDTO(latest);

	return (
		<section className="card overflow-hidden">
			<div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-4">
				<h2 className="font-medium">Daily brief</h2>
				<Link href="/stocks/daily-log" className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline whitespace-nowrap">
					All logs →
				</Link>
			</div>
			<div className="p-6 sm:p-8">
				<DailyLogReader entry={dto} />
			</div>
		</section>
	);
}
