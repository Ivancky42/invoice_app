import { getPortfolio, getSyncStatus } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import {
  actionBadgeClass,
  decToNum,
  fmtMoney,
  fmtPct,
  pnl,
  riskBadgeClass,
} from "@/lib/stocks/format";

export const revalidate = 900;

export default async function PortfolioPage() {
  const [rows, status] = await Promise.all([getPortfolio(), getSyncStatus()]);

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
                <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                  No holdings yet — run the Notion sync.
                </td>
              </tr>
            )}
            {rows.map((p) => {
              const cur = decToNum(p.currentPrice);
              const cost = decToNum(p.myAvgCost);
              const r = pnl(cur, cost);
              return (
                <tr key={p.notionId} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.ticker}</div>
                    <div className="text-xs text-gray-500">{p.company ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{fmtMoney(cur)}</td>
                  <td className="px-4 py-3 text-right">{fmtMoney(cost)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className={(r.pct ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"}>
                      {fmtPct(r.pct)}
                    </div>
                    <div className="text-xs text-gray-500">{fmtMoney(r.dollar)}</div>
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

      {rows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Theses</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((p) =>
              p.thesis ? (
                <div key={`th-${p.notionId}`} className="card p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium">{p.ticker}</div>
                    {p.sectorTag && <span className="text-xs text-gray-500">{p.sectorTag}</span>}
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.thesis}</p>
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
