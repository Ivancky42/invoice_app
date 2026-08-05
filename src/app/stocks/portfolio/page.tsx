import { getPortfolio, getSyncStatus, getTrades } from "@/lib/stocks/db";
import {
  getEarningsRiskThresholds,
  getSentimentThresholds,
} from "@/lib/stocks/config";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { NotesModalField } from "@/app/stocks/_components/NotesModalField";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";
import { asReportBlocks, hasReportBlocks } from "@/lib/content/blocks";
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
import { resolvePositionShares } from "@/lib/stocks/portfolioTotals";
import {
  DERIVED_EARNINGS_RISK_CLASS,
  DERIVED_EARNINGS_RISK_LABEL,
  DERIVED_SENTIMENT_CLASS,
  DERIVED_SENTIMENT_LABEL,
  positionActionLabel,
  riskLevelLabel,
  themeLabel,
} from "@/lib/stocks/labels";
import { earningsRiskFromDays, sentimentFromScore } from "@/lib/stocks/derived";

export const revalidate = 900;

export default async function PortfolioPage() {
  const [rows, trades, status, sentimentThresholds, earningsRiskThresholds] =
    await Promise.all([
      getPortfolio(),
      getTrades(),
      getSyncStatus(),
      getSentimentThresholds(),
      getEarningsRiskThresholds(),
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
              const shares = resolvePositionShares(p, holdings);
              const cashRow = isCashTicker(p.ticker);
              const cashBal = cashRow ? notionCashBalanceUsd(p.currentPrice, p.myAvgCost) : 0;
              const per = cashRow ? { pct: null } : pnl(cur, cost);
              const pos = cashRow
                ? { dollar: null }
                : positionPnl(cur, cost, shares);
              const derivedSentiment = sentimentFromScore(
                p.socialScore,
                sentimentThresholds,
              );
              const derivedEarningsRisk = earningsRiskFromDays(
                p.daysToEarnings,
                earningsRiskThresholds,
              );
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{p.ticker}</span>
                      {!cashRow && p.inDcaZone && (
                        <span className="badge bg-emerald-100 text-emerald-800 whitespace-nowrap" title="Badge only when Current price is between two numbers parsed from Entry zone. A single price in that field does not turn this on.">
                          📉 Add zone
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {cashRow ? "Cash balance" : (p.company ?? "—")}
                    </div>
                    {derivedSentiment && (
                      <span className={`badge mt-1 ${DERIVED_SENTIMENT_CLASS[derivedSentiment]}`}>
                        {DERIVED_SENTIMENT_LABEL[derivedSentiment]}
                      </span>
                    )}
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
                      <span className={`badge ${actionBadgeClass(p.action)}`}>
                        {positionActionLabel(p.action)}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.riskLevel ? (
                      <span className={`badge ${riskBadgeClass(p.riskLevel)}`}>
                        {riskLevelLabel(p.riskLevel)}
                      </span>
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
                        {derivedEarningsRisk && (
                          <span className={`badge mt-1 ${DERIVED_EARNINGS_RISK_CLASS[derivedEarningsRisk]}`}>
                            {DERIVED_EARNINGS_RISK_LABEL[derivedEarningsRisk]}
                          </span>
                        )}
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

      {rows.length > 0 && rows.some((p) => hasReportBlocks(p.thesis) || hasReportBlocks(p.pageNotes) || p.keyRisk || p.entryZone) && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Theses &amp; notes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((p) =>
              hasReportBlocks(p.thesis) || hasReportBlocks(p.pageNotes) || p.keyRisk || p.entryZone ? (
                <div key={`th-${p.id}`} className="card p-4">
                  <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{p.ticker}</span>
                      {!isCashTicker(p.ticker) && p.inDcaZone && (
                        <span className="badge bg-emerald-100 text-emerald-800 whitespace-nowrap" title="Badge only when Current price is between two numbers parsed from Entry zone. A single price in that field does not turn this on.">
                          📉 Add zone
                        </span>
                      )}
                    </div>
                    {p.theme ? (
                      <span className="text-xs text-gray-500">{themeLabel(p.theme)}</span>
                    ) : p.sectorTagRaw ? (
                      <span className="text-xs text-gray-400">{p.sectorTagRaw}</span>
                    ) : null}
                  </div>
                  {p.entryZone && (
                    <p className={`text-sm text-gray-700 ${hasReportBlocks(p.thesis) || hasReportBlocks(p.pageNotes) || p.keyRisk ? "mb-3" : ""}`}>
                      <span className="font-medium text-gray-700">Entry zone: </span>
                      <span className="whitespace-pre-wrap">{p.entryZone}</span>
                    </p>
                  )}
                  {hasReportBlocks(p.thesis) && (
                    <ReportBlocks blocks={asReportBlocks(p.thesis)} className="space-y-2" />
                  )}
                  {hasReportBlocks(p.pageNotes) && (
                    <div className={hasReportBlocks(p.thesis) ? "mt-3 pt-3 border-t border-gray-100" : ""}>
                      <NotesModalField label="Notes" text={asReportBlocks(p.pageNotes)} context={p.ticker} />
                    </div>
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
