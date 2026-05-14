import Link from "next/link";
import { getPortfolio, getSyncStatus, getTrades, getWatchlist } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { DonutChart, type DonutSegment } from "@/app/_components/DonutChart";
import { StocksDailyBriefCard } from "@/app/stocks/_components/StocksDailyBriefCard";
import {
  decToNum,
  fmtMoney,
  fmtPct,
  holdingsByTicker,
  isCashTicker,
  notionCashBalanceUsd,
  pnl,
  positionPnl,
} from "@/lib/stocks/format";

export const revalidate = 900;

const TICKER_PALETTE = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
];

const RISK_COLORS: Record<string, string> = {
  Low: "#10b981",
  "Low-Medium": "#22c55e",
  Medium: "#eab308",
  "Medium-High": "#f97316",
  High: "#ef4444",
  "Very High": "#b91c1c",
  Unknown: "#9ca3af",
};

const CASH_DONUT_COLOR = "#64748b";

export default async function StocksOverview() {
  const [portfolio, watchlist, trades, status] = await Promise.all([
    getPortfolio(),
    getWatchlist(),
    getTrades(),
    getSyncStatus(),
  ]);

  const holdings = holdingsByTicker(trades);

  let totalPnlDollar = 0;
  let totalEquitiesMarketValue = 0;
  let hasPnl = false;
  let hasEquitiesValue = false;

  type Row = {
    ticker: string;
    action: string | null;
    riskLevel: string | null;
    shares: number | null;
    pnlDollar: number | null;
    pnlPct: number | null;
    marketValue: number | null;
  };

  const rows: Row[] = portfolio.map((p) => {
    if (isCashTicker(p.ticker)) {
      const bal = notionCashBalanceUsd(p.currentPrice, p.myAvgCost);
      return {
        ticker: p.ticker,
        action: p.action,
        riskLevel: p.riskLevel,
        shares: null,
        pnlDollar: null,
        pnlPct: null,
        marketValue: bal > 0 ? bal : null,
      };
    }
    const cur = decToNum(p.currentPrice);
    const cost = decToNum(p.myAvgCost);
    const shares = holdings.get(p.ticker) ?? null;
    const r = positionPnl(cur, cost, shares);
    const per = pnl(cur, cost);
    if (r.dollar !== null) {
      totalPnlDollar += r.dollar;
      hasPnl = true;
    }
    if (r.marketValue !== null && r.marketValue > 0) {
      totalEquitiesMarketValue += r.marketValue;
      hasEquitiesValue = true;
    }
    return {
      ticker: p.ticker,
      action: p.action,
      riskLevel: p.riskLevel,
      shares,
      pnlDollar: r.dollar,
      pnlPct: per.pct,
      marketValue: r.marketValue,
    };
  });

  const cashPosition = rows
    .filter((r) => isCashTicker(r.ticker) && r.marketValue !== null && r.marketValue > 0)
    .reduce((s, r) => s + (r.marketValue as number), 0);

  const movers = rows
    .filter((m) => m.pnlPct !== null)
    .sort((a, b) => Math.abs(b.pnlPct ?? 0) - Math.abs(a.pnlPct ?? 0))
    .slice(0, 5);

  const openTrades = trades.filter((t) => t.status?.includes("Open")).length;

  const totalPortfolioValue = totalEquitiesMarketValue + cashPosition;

  type ValueSlice = {
    label: string;
    value: number;
    sublabel?: string;
    isCash: boolean;
  };
  const valueSlices: ValueSlice[] = rows
    .filter((r) => r.marketValue !== null && r.marketValue > 0)
    .map((r) => ({
      label: isCashTicker(r.ticker) ? "Cash" : r.ticker,
      value: r.marketValue as number,
      sublabel: isCashTicker(r.ticker)
        ? undefined
        : r.shares !== null
          ? `${r.shares.toLocaleString()} sh`
          : undefined,
      isCash: isCashTicker(r.ticker),
    }))
    .sort((a, b) => b.value - a.value);

  let paletteIdx = 0;
  const valueSegments: DonutSegment[] = valueSlices.map((s) => ({
    label: s.label,
    value: s.value,
    sublabel: s.sublabel,
    color: s.isCash ? CASH_DONUT_COLOR : TICKER_PALETTE[paletteIdx++ % TICKER_PALETTE.length],
  }));

  const riskTotals = new Map<string, number>();
  for (const r of rows) {
    if (r.marketValue === null || r.marketValue <= 0) continue;
    if (isCashTicker(r.ticker)) {
      riskTotals.set("Cash", (riskTotals.get("Cash") ?? 0) + r.marketValue);
    } else {
      const key = r.riskLevel ?? "Unknown";
      riskTotals.set(key, (riskTotals.get(key) ?? 0) + r.marketValue);
    }
  }
  const RISK_ORDER = ["Low", "Low-Medium", "Medium", "Medium-High", "High", "Very High", "Unknown"];
  function riskSliceOrder(label: string): number {
    if (label === "Cash") return RISK_ORDER.length + 1;
    const i = RISK_ORDER.indexOf(label);
    return i === -1 ? RISK_ORDER.length : i;
  }
  const riskSegments: DonutSegment[] = Array.from(riskTotals.entries())
    .sort((a, b) => riskSliceOrder(a[0]) - riskSliceOrder(b[0]))
    .map(([label, value]) => ({
      label,
      value,
      color: label === "Cash" ? CASH_DONUT_COLOR : (RISK_COLORS[label] ?? "#9ca3af"),
    }));

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stocks</h1>
          <p className="text-sm text-gray-500">Read-only mirror of Notion. Refreshed every 15 minutes.</p>
        </div>
      </section>

      <SyncStatusBanner status={status} />

      <StocksDailyBriefCard />

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
          <div className="text-xs text-gray-500">Unrealized P&L (portfolio)</div>
          <div className={`text-2xl font-semibold mt-1 ${totalPnlDollar >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {hasPnl ? fmtMoney(totalPnlDollar) : "—"}
          </div>
          {(hasEquitiesValue || cashPosition > 0) && (
            <div className="text-xs text-gray-500 mt-1">
              {cashPosition > 0 && hasEquitiesValue && (
                <>
                  Equities {fmtMoney(totalEquitiesMarketValue)} · Cash {fmtMoney(cashPosition)} · Total{" "}
                  {fmtMoney(totalPortfolioValue)}
                </>
              )}
              {cashPosition > 0 && !hasEquitiesValue && <>Cash {fmtMoney(cashPosition)}</>}
              {cashPosition === 0 && hasEquitiesValue && <>Market value {fmtMoney(totalEquitiesMarketValue)}</>}
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium">Portfolio breakdown by value</h2>
            <Link href="/stocks/portfolio" className="text-sm hover:underline">
              View portfolio
            </Link>
          </div>
          <DonutChart
            segments={valueSegments}
            centerValue={totalPortfolioValue > 0 ? totalPortfolioValue : undefined}
            centerLabel="Total value"
          />
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium">Allocation by risk level</h2>
            <span className="text-xs text-gray-500">% of equities + cash</span>
          </div>
          <DonutChart
            segments={riskSegments}
            centerValue={totalPortfolioValue > 0 ? totalPortfolioValue : undefined}
            centerLabel="Total value"
          />
        </div>
      </section>

      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-medium">Top movers (vs avg cost)</h2>
          <Link href="/stocks/portfolio" className="text-sm hover:underline">View portfolio</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-2">Ticker</th>
                <th className="text-left px-5 py-2">Action</th>
                <th className="text-right px-5 py-2">Shares</th>
                <th className="text-right px-5 py-2">P&L %</th>
                <th className="text-right px-5 py-2">P&L $</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {movers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-sm text-gray-500">
                    No portfolio data yet.
                  </td>
                </tr>
              )}
              {movers.map((m) => (
                <tr key={m.ticker} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">{m.ticker}</td>
                  <td className="px-5 py-3">
                    {m.action ? (
                      <span className="badge bg-gray-100 text-gray-700">{m.action}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {m.shares !== null ? m.shares.toLocaleString() : "—"}
                  </td>
                  <td
                    className={`px-5 py-3 text-right tabular-nums ${
                      (m.pnlPct ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {fmtPct(m.pnlPct)}
                  </td>
                  <td
                    className={`px-5 py-3 text-right tabular-nums ${
                      (m.pnlDollar ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {m.pnlDollar !== null ? fmtMoney(m.pnlDollar) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
