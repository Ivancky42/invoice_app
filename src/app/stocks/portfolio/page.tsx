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
  fmtDayUtc,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtTicker,
  holdingsByTicker,
  isCashTicker,
  isCspxTicker,
  notionCashBalanceUsd,
  pnl,
  pnlToneClass,
  positionPnl,
  priceInZone,
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
  sleeveLabel,
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
        <p className="text-sm text-gray-500">
          Current holdings — prices from sync; actions / zones / notes from agents.
        </p>
      </section>

      <SyncStatusBanner status={status} />

      <section className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Ticker</th>
              <th className="text-right px-4 py-2">Shares</th>
              <th className="text-right px-4 py-2">Price</th>
              <th className="text-right px-4 py-2">Avg</th>
              <th className="text-right px-4 py-2">P&L</th>
              <th className="text-right px-4 py-2">Upside</th>
              <th className="text-left px-4 py-2">Action</th>
              <th className="text-left px-4 py-2">Sleeve</th>
              <th className="text-center px-4 py-2">Conv</th>
              <th className="text-center px-4 py-2">Adds</th>
              <th className="text-left px-4 py-2">Risk</th>
              <th className="text-right px-4 py-2">Earnings</th>
              <th className="text-right px-4 py-2">Stop</th>
              <th className="text-right px-4 py-2">Px as of</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={14} className="px-4 py-8 text-center text-gray-500">
                  No holdings yet — run Update prices.
                </td>
              </tr>
            )}
            {rows.map((p) => {
              const cur = decToNum(p.currentPrice);
              const cost = decToNum(p.myAvgCost);
              const shares = resolvePositionShares(p, holdings);
              const cashRow = isCashTicker(p.ticker);
              const cashBal = cashRow ? notionCashBalanceUsd(p.currentPrice, p.myAvgCost) : 0;
              const per = cashRow ? { pct: null as number | null } : pnl(cur, cost);
              const pos = cashRow
                ? { dollar: null as number | null }
                : positionPnl(cur, cost, shares);
              const inEntry = !cashRow && priceInZone(p.currentPrice, p.entryZone);
              const inAdd = !cashRow && priceInZone(p.currentPrice, p.addZone);
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
                      <span className="font-semibold tracking-wide tabular-nums">
                        {fmtTicker(p.ticker)}
                      </span>
                      {isCspxTicker(p.ticker) && (
                        <span className="badge bg-slate-100 text-slate-600">Passive</span>
                      )}
                      {inEntry && (
                        <span
                          className="badge bg-sky-100 text-sky-800 whitespace-nowrap"
                          title="Price inside Entry Zone band"
                        >
                          In entry
                        </span>
                      )}
                      {inAdd && (
                        <span
                          className="badge bg-emerald-100 text-emerald-800 whitespace-nowrap"
                          title="Price inside Add Zone band (§12.7)"
                        >
                          In add zone
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
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cashRow ? fmtMoney(cashBal > 0 ? cashBal : null) : fmtMoney(cur)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cashRow ? <span className="text-gray-400">—</span> : fmtMoney(cost)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cashRow ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <>
                        <div className={pnlToneClass(pos.dollar)}>
                          {pos.dollar !== null ? fmtMoney(pos.dollar) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </div>
                        <div className={`text-xs ${pnlToneClass(per.pct)}`}>{fmtPct(per.pct)}</div>
                      </>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${pnlToneClass(decToNum(p.upsidePct))}`}>
                    {cashRow ? "—" : fmtPct(p.upsidePct)}
                  </td>
                  <td className="px-4 py-3">
                    {p.action ? (
                      <span className={`badge ${actionBadgeClass(p.action)}`}>
                        {positionActionLabel(p.action)}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">
                    {cashRow ? "—" : sleeveLabel(p.sleeve)}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {cashRow ? "—" : (p.conviction ?? "—")}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {cashRow ? "—" : (p.addsUsed ?? "—")}
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
                        <div className="font-medium tabular-nums">{p.daysToEarnings}d</div>
                        <div className="text-xs text-gray-500">{fmtDayUtc(p.earningsDate)}</div>
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
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmtMoney(decToNum(p.stopLoss))}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500 tabular-nums">
                    {fmtDayUtc(p.lastPriceUpdate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {rows.length > 0 &&
        rows.some(
          (p) =>
            hasReportBlocks(p.thesis) ||
            hasReportBlocks(p.pageNotes) ||
            p.keyRisk ||
            p.entryZone ||
            p.addZone ||
            p.nextAddTrigger,
        ) && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-gray-700">Theses, zones &amp; notes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {rows.map((p) =>
                hasReportBlocks(p.thesis) ||
                hasReportBlocks(p.pageNotes) ||
                p.keyRisk ||
                p.entryZone ||
                p.addZone ||
                p.nextAddTrigger ? (
                  <div key={`th-${p.id}`} className="card p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold tracking-wide">{fmtTicker(p.ticker)}</span>
                        {!isCashTicker(p.ticker) && priceInZone(p.currentPrice, p.entryZone) && (
                          <span className="badge bg-sky-100 text-sky-800">In entry</span>
                        )}
                        {!isCashTicker(p.ticker) && priceInZone(p.currentPrice, p.addZone) && (
                          <span className="badge bg-emerald-100 text-emerald-800">In add zone</span>
                        )}
                      </div>
                      {p.theme ? (
                        <span className="text-xs text-gray-500">{themeLabel(p.theme)}</span>
                      ) : p.sectorTagRaw ? (
                        <span className="text-xs text-gray-400">{p.sectorTagRaw}</span>
                      ) : null}
                    </div>
                    <dl className="grid grid-cols-1 gap-1.5 text-sm">
                      {p.entryZone && (
                        <div>
                          <dt className="text-xs text-gray-500 inline">Entry zone · </dt>
                          <dd className="inline text-gray-800">{p.entryZone}</dd>
                        </div>
                      )}
                      {p.addZone && (
                        <div>
                          <dt className="text-xs text-gray-500 inline">Add zone · </dt>
                          <dd className="inline text-gray-800">{p.addZone}</dd>
                        </div>
                      )}
                      {p.nextAddTrigger && (
                        <div>
                          <dt className="text-xs text-gray-500 inline">Next add trigger · </dt>
                          <dd className="inline text-gray-800">{p.nextAddTrigger}</dd>
                        </div>
                      )}
                    </dl>
                    {hasReportBlocks(p.thesis) && (
                      <ReportBlocks blocks={asReportBlocks(p.thesis)} className="space-y-2" />
                    )}
                    {hasReportBlocks(p.pageNotes) && (
                      <div className={hasReportBlocks(p.thesis) ? "pt-2 border-t border-gray-100" : ""}>
                        <NotesModalField
                          label="Notes"
                          text={asReportBlocks(p.pageNotes)}
                          context={fmtTicker(p.ticker)}
                        />
                      </div>
                    )}
                    {p.keyRisk && (
                      <p className="text-xs text-amber-700">
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
