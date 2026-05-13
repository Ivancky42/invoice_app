import Link from "next/link";
import { getPortfolio, getSyncStatus, getTrades, getWatchlist } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { decToNum, fmtMoney, fmtPct, pnl } from "@/lib/stocks/format";

export const revalidate = 900;

export default async function StocksOverview() {
  const [portfolio, watchlist, trades, status] = await Promise.all([
    getPortfolio(),
    getWatchlist(),
    getTrades(),
    getSyncStatus(),
  ]);

  let totalUnrealizedDollar = 0;
  let hasPnl = false;
  const movers = portfolio
    .map((p) => {
      const cur = decToNum(p.currentPrice);
      const cost = decToNum(p.myAvgCost);
      const r = pnl(cur, cost);
      if (r.dollar !== null) {
        totalUnrealizedDollar += r.dollar;
        hasPnl = true;
      }
      return { ticker: p.ticker, action: p.action, pnlPct: r.pct, pnlDollar: r.dollar };
    })
    .filter((m) => m.pnlPct !== null)
    .sort((a, b) => Math.abs(b.pnlPct ?? 0) - Math.abs(a.pnlPct ?? 0))
    .slice(0, 5);

  const openTrades = trades.filter((t) => t.status?.includes("Open")).length;

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stocks</h1>
          <p className="text-sm text-gray-500">Read-only mirror of Notion. Refreshed every 15 minutes.</p>
        </div>
      </section>

      <SyncStatusBanner status={status} />

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link href="/stocks/portfolio" className="card p-4 hover:shadow-sm transition">
          <div className="text-xs text-gray-500">Holdings</div>
          <div className="text-2xl font-semibold mt-1">{portfolio.length}</div>
        </Link>
        <Link href="/stocks/watchlist" className="card p-4 hover:shadow-sm transition">
          <div className="text-xs text-gray-500">Watching</div>
          <div className="text-2xl font-semibold mt-1">{watchlist.length}</div>
        </Link>
        <Link href="/stocks/trades" className="card p-4 hover:shadow-sm transition">
          <div className="text-xs text-gray-500">Open trades</div>
          <div className="text-2xl font-semibold mt-1">{openTrades}</div>
        </Link>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Unrealized P&L (per share, summed)</div>
          <div className={`text-2xl font-semibold mt-1 ${totalUnrealizedDollar >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {hasPnl ? fmtMoney(totalUnrealizedDollar) : "—"}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-medium">Top movers (vs avg cost)</h2>
          <Link href="/stocks/portfolio" className="text-sm hover:underline">View portfolio</Link>
        </div>
        <div className="divide-y">
          {movers.length === 0 && (
            <div className="px-5 py-6 text-sm text-gray-500">No portfolio data yet.</div>
          )}
          {movers.map((m) => (
            <div key={m.ticker} className="px-5 py-3 flex items-center justify-between">
              <div className="font-medium">{m.ticker}</div>
              <div className="flex items-center gap-4 text-sm">
                {m.action && <span className="badge bg-gray-100 text-gray-700">{m.action}</span>}
                <span className={(m.pnlPct ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"}>
                  {fmtPct(m.pnlPct)}
                </span>
                <span className={`${(m.pnlDollar ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"} text-xs text-gray-500`}>
                  {fmtMoney(m.pnlDollar)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
