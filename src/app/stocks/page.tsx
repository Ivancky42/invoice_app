import Link from "next/link";
import { getPortfolio, getPortfolioSnapshots, getSyncStatus, getTrades, getWatchlist } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { DonutChart, type DonutSegment } from "@/app/_components/DonutChart";
import { PortfolioChartPanel } from "@/app/stocks/_components/PortfolioChartPanel";
import { StocksDailyBriefCard } from "@/app/stocks/_components/StocksDailyBriefCard";
import {
  decToNum,
  fmtMoney,
  fmtPct,
  fmtTicker,
  holdingsByTicker,
  isCashTicker,
  notionCashBalanceUsd,
  pnl,
  pnlToneClass,
  positionPnl,
} from "@/lib/stocks/format";
import { computePortfolioTotals, resolvePositionShares } from "@/lib/stocks/portfolioTotals";
import {
  assignPortfolioValueColors,
  CASH_DONUT_COLOR,
  getPortfolioHoldingColor,
  PORTFOLIO_TICKER_PALETTE,
} from "@/lib/stocks/chartColors";
import { TradeStatus, type RiskLevel, type Theme } from "@/generated/prisma/client";
import {
  positionActionLabel,
  RISK_LEVEL_COLOR,
  RISK_LEVEL_LABEL,
  THEME_COLOR,
  THEME_LABEL,
} from "@/lib/stocks/labels";

export const revalidate = 900;

const RISK_ORDER: RiskLevel[] = [
  "LOW",
  "LOW_MEDIUM",
  "MEDIUM",
  "MEDIUM_HIGH",
  "HIGH",
  "VERY_HIGH",
];


export default async function StocksOverview() {
  const [portfolio, watchlist, trades, status, snapshotHistory] = await Promise.all([
    getPortfolio(),
    getWatchlist(),
    getTrades(),
    getSyncStatus(),
    getPortfolioSnapshots(),
  ]);

  const holdings = holdingsByTicker(trades);
  const portfolioTotals = computePortfolioTotals(portfolio, trades);

  let totalPnlDollar = portfolioTotals.unrealizedPnl;
  const hasPnl = portfolioTotals.hasPnl;
  const totalEquitiesMarketValue = portfolioTotals.equitiesValue;
  const hasEquitiesValue = portfolioTotals.equitiesValue > 0;
  const cashPosition = portfolioTotals.cashValue;
  const totalPortfolioValue = portfolioTotals.totalValue;

  type Row = {
    ticker: string;
    action: (typeof portfolio)[number]["action"];
    riskLevel: (typeof portfolio)[number]["riskLevel"];
    theme: Theme | null;
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
        theme: p.theme,
        shares: null,
        pnlDollar: null,
        pnlPct: null,
        marketValue: bal > 0 ? bal : null,
      };
    }
    const cur = decToNum(p.currentPrice);
    const cost = decToNum(p.myAvgCost);
    const shares = resolvePositionShares(p, holdings);
    const r = positionPnl(cur, cost, shares);
    const per = pnl(cur, cost);
    return {
      ticker: p.ticker,
      action: p.action,
      riskLevel: p.riskLevel,
      theme: p.theme,
      shares,
      pnlDollar: r.dollar,
      pnlPct: per.pct,
      marketValue: r.marketValue,
    };
  });

  const movers = rows
    .filter((m) => m.pnlPct !== null)
    .sort((a, b) => Math.abs(b.pnlPct ?? 0) - Math.abs(a.pnlPct ?? 0))
    .slice(0, 5);

  const openTrades = trades.filter((t) => t.status === TradeStatus.OPEN).length;

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

  const valueColorMap = assignPortfolioValueColors(
    valueSlices.map((s) => ({
      key: s.isCash ? "CASH_USD" : s.label,
      value: s.value,
      isCash: s.isCash,
    })),
  );
  const valueSegments: DonutSegment[] = valueSlices.map((s, i) => ({
    label: s.label,
    value: s.value,
    sublabel: s.sublabel,
    color: getPortfolioHoldingColor(valueColorMap, s.isCash ? "CASH_USD" : s.label, i),
  }));

  const riskTotals = new Map<string, number>();
  for (const r of rows) {
    if (r.marketValue === null || r.marketValue <= 0) continue;
    if (isCashTicker(r.ticker)) {
      riskTotals.set("Cash", (riskTotals.get("Cash") ?? 0) + r.marketValue);
    } else {
      const key = r.riskLevel ? RISK_LEVEL_LABEL[r.riskLevel] : "Unknown";
      riskTotals.set(key, (riskTotals.get(key) ?? 0) + r.marketValue);
    }
  }
  function riskSliceOrder(label: string): number {
    if (label === "Cash") return RISK_ORDER.length + 2;
    if (label === "Unknown") return RISK_ORDER.length;
    const level = RISK_ORDER.find((r) => RISK_LEVEL_LABEL[r] === label);
    if (!level) return RISK_ORDER.length + 1;
    return RISK_ORDER.indexOf(level);
  }
  const riskSegments: DonutSegment[] = Array.from(riskTotals.entries())
    .sort((a, b) => riskSliceOrder(a[0]) - riskSliceOrder(b[0]))
    .map(([label, value]) => {
      const level = RISK_ORDER.find((r) => RISK_LEVEL_LABEL[r] === label);
      return {
        label,
        value,
        color:
          label === "Cash"
            ? CASH_DONUT_COLOR
            : level
              ? RISK_LEVEL_COLOR[level]
              : "#9ca3af",
      };
    });

  const sectorTotals = new Map<string, number>();
  const sectorThemeByLabel = new Map<string, Theme | null>();
  for (const r of rows) {
    if (r.marketValue === null || r.marketValue <= 0) continue;
    const label = isCashTicker(r.ticker)
      ? "Cash"
      : r.theme
        ? THEME_LABEL[r.theme]
        : "Unspecified";
    sectorTotals.set(label, (sectorTotals.get(label) ?? 0) + r.marketValue);
    if (!sectorThemeByLabel.has(label)) {
      sectorThemeByLabel.set(label, isCashTicker(r.ticker) ? null : r.theme);
    }
  }
  let sectorPaletteIdx = 0;
  const sectorSegments: DonutSegment[] = Array.from(sectorTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => {
      const theme = sectorThemeByLabel.get(label);
      return {
        label,
        value,
        color:
          label === "Cash"
            ? CASH_DONUT_COLOR
            : theme
              ? THEME_COLOR[theme]
              : PORTFOLIO_TICKER_PALETTE[sectorPaletteIdx++ % PORTFOLIO_TICKER_PALETTE.length],
      };
    });

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stocks</h1>
          <p className="text-sm text-gray-500">
            Read-only Neon cache. Daily ~06:00 GMT+8 Finnhub→Notion; ~09:30 GMT+8 Notion→Neon (page revalidate 15m).
          </p>
        </div>
      </section>

      <SyncStatusBanner status={status} />

      <StocksDailyBriefCard />

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
        <Link href="/stocks/decisions" className="card p-4 hover:shadow-sm transition">
          <div className="text-xs text-gray-500">Decisions</div>
          <div className="text-sm font-medium mt-2 text-gray-700">Review log →</div>
        </Link>
        <Link href="/stocks/shadow" className="card p-4 hover:shadow-sm transition">
          <div className="text-xs text-gray-500">Shadow books</div>
          <div className="text-sm font-medium mt-2 text-gray-700">Evolution loop →</div>
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

      <section className="card p-5 flex flex-col">
        <div className="flex items-center justify-between mb-3 gap-4 shrink-0">
          <div>
            <h2 className="font-medium">Portfolio value over time</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Daily stacked bars by holding + CASH_USD. Priced via Notion sync (CSPX via EODHD).
            </p>
          </div>
          {totalPortfolioValue > 0 ? (
            <span className="text-xs text-gray-500 shrink-0">Live {fmtMoney(totalPortfolioValue)}</span>
          ) : null}
        </div>
        <PortfolioChartPanel points={snapshotHistory} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium">Allocation by theme</h2>
          <span className="text-xs text-gray-500">Theme · % of total</span>
        </div>
        <DonutChart
          segments={sectorSegments}
          centerValue={totalPortfolioValue > 0 ? totalPortfolioValue : undefined}
          centerLabel="Total value"
        />
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
                  <td className="px-5 py-3 font-medium tracking-wide tabular-nums">
                    {isCashTicker(m.ticker) ? "Cash" : fmtTicker(m.ticker)}
                  </td>
                  <td className="px-5 py-3">
                    {m.action ? (
                      <span className="badge bg-gray-100 text-gray-700">
                        {positionActionLabel(m.action)}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {m.shares !== null ? m.shares.toLocaleString() : "—"}
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums ${pnlToneClass(m.pnlPct)}`}>
                    {fmtPct(m.pnlPct)}
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums ${pnlToneClass(m.pnlDollar)}`}>
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
