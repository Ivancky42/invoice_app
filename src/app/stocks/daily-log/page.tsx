import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { dailyLogToDTO, getDailyLogs, getSyncStatus } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { DailyLogReader } from "@/app/stocks/_components/DailyLogReader";
import { DailyLogPastTable } from "@/app/stocks/_components/DailyLogPastTable";

export default async function DailyLogPage() {
	noStore();

	const [logs, status] = await Promise.all([getDailyLogs(), getSyncStatus()]);
	const latest = logs[0] ?? null;
	const older = logs.slice(1).map(dailyLogToDTO);
	const latestDto = latest ? dailyLogToDTO(latest) : null;

	return (
		<div className="space-y-6">
			<section className="flex items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Daily log</h1>
					<p className="text-sm text-gray-500 mt-1">Synced from Notion. Latest entry appears as today&apos;s brief.</p>
				</div>
				<Link href="/stocks" className="text-sm text-gray-600 hover:text-gray-900 hover:underline shrink-0">
					← Overview
				</Link>
			</section>

			<SyncStatusBanner status={status} />

			{!latestDto ? (
				<div className="card p-8 text-center text-sm text-gray-500">
					No daily logs synced yet. Add <code className="text-xs bg-gray-100 px-1 rounded">NOTION_DAILY_LOG_DB</code> to env and{" "}
					run a sync.
				</div>
			) : (
				<>
					<section className="card p-6 sm:p-8">
						<div className="flex items-center justify-between gap-4 mb-4">
							<h2 className="text-lg font-medium text-gray-900">Daily brief</h2>
							<span className="text-xs font-medium uppercase tracking-wide text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
								Latest
							</span>
						</div>
						<DailyLogReader entry={latestDto} />
					</section>

					<section className="card overflow-hidden">
						<div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
							<h2 className="font-medium">Earlier logs</h2>
							<span className="text-xs text-gray-500">{older.length} entries</span>
						</div>
						<DailyLogPastTable rows={older} />
					</section>
				</>
			)}
		</div>
	);
}
