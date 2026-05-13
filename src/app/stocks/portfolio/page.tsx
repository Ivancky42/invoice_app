import { getPortfolio, getSyncStatus, getTrades } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import {
  actionBadgeClass,
  decToNum,
  fmtMoney,
  fmtNum,
  fmtPct,
  holdingsByTicker,
  isCashTicker,
  notionCashBalanceUsd,
  pnl,
  positionPnl,
  riskBadgeClass,
} from "@/lib/stocks/format";

export const revalidate = 900;

export default async function PortfolioPage() {
  const [rows, trades, status] = await Promise.all([
    getPortfolio(),
    getTrades(),
    getSyncStatus(),
  ]);
  const holdings = holdingsByTicker(trades);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-sm text-gray-500">Current holdings.</p>
      </section>

      <SyncStatusBanner status={status} />

      <section className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Ticker</th>
              <th className="text-right px-4 py-2">Shares</th>
              <th className="text-right px-4 py-2">Price</th>
              <th className="text-right px-4 py-2">Avg Cost</th>
              <th className="text-right px-4 py-2">P&L</th>
              <th className="text-right px-4 py-2">Target</th>
              <th className="text-right px-4 py-2">Upside</th>
              <th className="text-left px-4 py-2">Action</th>
              <th className="text-left px-4 py-2">Risk</th>
              <th className="text-right px-4 py-2">Earnings</th>
              <th className="text-right px-4 py-2">Stop Loss</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-gray-500">
                  No holdings yet — run the Notion sync.
                </td>
              </tr>
            )}
            {rows.map((p) => {
              const cur = decToNum(p.currentPrice);
              const cost = decToNum(p.myAvgCost);
              const shares = holdings.get(p.ticker) ?? null;
              const cashRow = isCashTicker(p.ticker);
              const cashBal = cashRow ? notionCashBalanceUsd(p.currentPrice, p.myAvgCost) : 0;
              const per = cashRow ? { pct: null } : pnl(cur, cost);
              const pos = cashRow
                ? { dollar: null }
                : positionPnl(cur, cost, shares);
              return (
                <tr key={p.notionId} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{p.ticker}</span>
                      {!cashRow && p.inDcaZone && (
                        <span className="badge bg-emerald-100 text-emerald-800 whitespace-nowrap" title="Current price is inside the Entry zone range (Notion Current Price vs Entry Zone)">
                          📉 Add zone
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {cashRow ? "Cash balance" : (p.company ?? "—")}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cashRow ? (
                      <span className="text-gray-400">—</span>
                    ) : shares !== null ? (
                      fmtNum(shares, 0)
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {cashRow ? fmtMoney(cashBal > 0 ? cashBal : null) : fmtMoney(cur)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {cashRow ? <span className="text-gray-400">—</span> : fmtMoney(cost)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {cashRow ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <>
                        <div className={(pos.dollar ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"}>
                          {pos.dollar !== null ? fmtMoney(pos.dollar) : <span className="text-gray-400">—</span>}
                        </div>
                        <div className="text-xs text-gray-500">{fmtPct(per.pct)}</div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{fmtMoney(decToNum(p.analystTarget))}</td>
                  <td className="px-4 py-3 text-right">{fmtPct(p.upsidePct)}</td>
                  <td className="px-4 py-3">
                    {p.action ? (
                      <span className={`badge ${actionBadgeClass(p.action)}`}>{p.action}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.riskLevel ? (
                      <span className={`badge ${riskBadgeClass(p.riskLevel)}`}>{p.riskLevel}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.daysToEarnings !== null ? (
                      <div>
                        <div className="font-medium">{p.daysToEarnings}d</div>
                        <div className="text-xs text-gray-500">
                          {p.earningsDate ? p.earningsDate.toISOString().slice(0, 10) : "—"}
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{fmtMoney(decToNum(p.stopLoss))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {rows.length > 0 && rows.some((p) => p.thesis || p.notes || p.keyRisk || p.entryZone) && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Theses &amp; notes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((p) =>
              p.thesis || p.notes || p.keyRisk || p.entryZone ? (
                <div key={`th-${p.notionId}`} className="card p-4">
                  <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{p.ticker}</span>
                      {!isCashTicker(p.ticker) && p.inDcaZone && (
                        <span className="badge bg-emerald-100 text-emerald-800 whitespace-nowrap" title="Current price is inside the Entry zone range synced from Notion">
                          📉 Add zone
                        </span>
                      )}
                    </div>
                    {p.sectorTag && <span className="text-xs text-gray-500">{p.sectorTag}</span>}
                  </div>
                  {p.entryZone && (
                    <p className={`text-sm text-gray-700 ${p.thesis || p.notes || p.keyRisk ? "mb-3" : ""}`}>
                      <span className="font-medium text-gray-700">Entry zone: </span>
                      <span className="whitespace-pre-wrap">{p.entryZone}</span>
                    </p>
                  )}
                  {p.thesis && (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.thesis}</p>
                  )}
                  {p.notes && (
                    <p
                      className={`text-sm text-gray-600 whitespace-pre-wrap ${p.thesis ? "mt-3 pt-3 border-t border-gray-100" : ""}`}
                    >
                      <span className="font-medium text-gray-700">Notes: </span>
                      {p.notes}
                    </p>
                  )}
                  {p.keyRisk && (
                    <p className="text-xs text-amber-700 mt-2">
                      <strong>Key risk:</strong> {p.keyRisk}
                    </p>
                  )}
                </div>
              ) : null,
            )}
          </div>
        </section>
      )}
    </div>
  );
}
