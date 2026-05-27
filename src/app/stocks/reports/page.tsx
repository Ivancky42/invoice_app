import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { getStockReports, getSyncStatus, stockReportToDTO } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { StockReportsTable } from "@/app/stocks/_components/StockReportsTable";

export default async function StockReportsPage() {
	noStore();

	const [reports, status] = await Promise.all([getStockReports(), getSyncStatus()]);
	const rows = reports.map(stockReportToDTO);

	return (
		<div className="space-y-6">
			<section className="flex items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Reports</h1>
					<p className="text-sm text-gray-500 mt-1">
						Weekly stock reports and monthly macro trend surveys synced from Notion Stock Monitor HQ.
					</p>
				</div>
				<Link href="/stocks" className="text-sm text-gray-600 hover:text-gray-900 hover:underline shrink-0">
					← Overview
				</Link>
			</section>

			<SyncStatusBanner status={status} />

			{rows.length === 0 ? (
				<div className="card p-8 text-center text-sm text-gray-500">
					No reports synced yet. Add{" "}
					<code className="text-xs bg-gray-100 px-1 rounded">NOTION_STOCK_HQ_PAGE_ID</code> to env and run a sync.
				</div>
			) : (
				<section className="card overflow-hidden">
					<div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
						<h2 className="font-medium">Weekly &amp; monthly reports</h2>
						<span className="text-xs text-gray-500">{rows.length} entries</span>
					</div>
					<StockReportsTable rows={rows} />
				</section>
			)}
		</div>
	);
}
