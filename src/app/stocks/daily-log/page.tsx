import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { dailyLogToDTO, getDailyLogs, getSyncStatus } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { DailyLogPastTable } from "@/app/stocks/_components/DailyLogPastTable";

export default async function DailyLogPage() {
	noStore();

	const [logs, status] = await Promise.all([getDailyLogs(), getSyncStatus()]);
	const rows = logs.map(dailyLogToDTO);

	return (
		<div className="space-y-6">
			<section className="flex items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Daily log</h1>
					<p className="text-sm text-gray-500 mt-1">
						Synced from Notion. Newest row first — open any row for the full brief (same view as Stocks overview).
					</p>
				</div>
				<Link href="/stocks" className="text-sm text-gray-600 hover:text-gray-900 hover:underline shrink-0">
					← Overview
				</Link>
			</section>

			<SyncStatusBanner status={status} />

			{rows.length === 0 ? (
				<div className="card p-8 text-center text-sm text-gray-500">
					No daily logs synced yet. Add <code className="text-xs bg-gray-100 px-1 rounded">NOTION_DAILY_LOG_DB</code> to env and{" "}
					run a sync.
				</div>
			) : (
				<section className="card overflow-hidden">
					<div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
						<h2 className="font-medium">Daily logs</h2>
						<span className="text-xs text-gray-500">{rows.length} entries</span>
					</div>
					<DailyLogPastTable rows={rows} />
				</section>
			)}
		</div>
	);
}
