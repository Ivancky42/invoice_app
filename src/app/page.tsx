import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSyncStatus } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { StocksDailyBriefCard } from "@/app/stocks/_components/StocksDailyBriefCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [docCount, portfolioCount, watchlistCount, tradesCount, syncStatus] = await Promise.all([
    prisma.document.count(),
    prisma.portfolio.count(),
    prisma.watchlist.count(),
    prisma.trade.count(),
    getSyncStatus(),
  ]);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold">Command Center</h1>
        <p className="text-sm text-gray-500 mt-1">Pick an app.</p>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/invoices" className="card p-6 hover:shadow-sm transition group">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Invoices</h2>
            <span className="text-xs text-gray-400 group-hover:text-gray-600">→</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Quotations, invoices, delivery orders.</p>
          <div className="mt-4 text-3xl font-semibold">{docCount}</div>
          <div className="text-xs text-gray-500">documents</div>
        </Link>

        <Link href="/stocks" className="card p-6 hover:shadow-sm transition group">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Stocks</h2>
            <span className="text-xs text-gray-400 group-hover:text-gray-600">→</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Portfolio, watchlist, trades, trends, ideas.</p>
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-2xl font-semibold">{portfolioCount}</div>
              <div className="text-xs text-gray-500">holdings</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{watchlistCount}</div>
              <div className="text-xs text-gray-500">watching</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{tradesCount}</div>
              <div className="text-xs text-gray-500">trades</div>
            </div>
          </div>
        </Link>
      </section>

      <section>
        <StocksDailyBriefCard />
      </section>

      <section>
        <SyncStatusBanner status={syncStatus} />
      </section>
    </div>
  );
}
