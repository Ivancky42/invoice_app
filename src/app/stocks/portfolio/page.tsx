import { getPortfolio, getSyncStatus, getTrades } from "@/lib/stocks/db";
import type { PortfolioRow } from "@/lib/stocks/db";
import {
  getEarningsRiskThresholds,
  getSentimentThresholds,
} from "@/lib/stocks/config";
import type { PositionAction } from "@/generated/prisma/client";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { ExpandableText } from "@/app/_components/ExpandableText";
import { NotesModalField } from "@/app/stocks/_components/NotesModalField";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";
import {
  asReportBlocks,
  blocksToPlainText,
  hasReportBlocks,
} from "@/lib/content/blocks";
import {
  actionBadgeClass,
  decToNum,
  fmtDayUtc,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtShortDateUtc,
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
import {
  computePortfolioTotals,
  exCspxNavFromTotals,
  positionWeightPctExCspx,
  resolvePositionShares,
} from "@/lib/stocks/portfolioTotals";
import {
  DERIVED_EARNINGS_RISK_CLASS,
  DERIVED_EARNINGS_RISK_LABEL,
  DERIVED_SENTIMENT_CLASS,
  DERIVED_SENTIMENT_LABEL,
  POSITION_ACTION_LABEL,
  positionActionLabel,
  riskLevelLabel,
  SLEEVE_CLASS,
  sleeveLabel,
  themeLabel,
} from "@/lib/stocks/labels";
import { earningsRiskFromDays, sentimentFromScore } from "@/lib/stocks/derived";
import { newestNoteFromTexts } from "@/lib/stocks/parseStockNotes";

export const revalidate = 900;

/** Urgency order — action columns left → right. */
const ACTION_ORDER: Array<PositionAction | null> = [
  "EXIT",
  "REDUCE",
  "ADD_ON_DIP",
  "WATCH",
  "HOLD",
  null,
];

function groupByAction(rows: PortfolioRow[]) {
  const groups: { key: PositionAction | null; label: string; items: PortfolioRow[] }[] =
    ACTION_ORDER.map((key) => ({
      key,
      label: key ? POSITION_ACTION_LABEL[key] : "No action",
      items: [],
    }));

  for (const r of rows) {
    if (isCashTicker(r.ticker)) continue;
    const idx = ACTION_ORDER.indexOf(r.action);
    groups[idx === -1 ? ACTION_ORDER.length - 1 : idx]!.items.push(r);
  }
  for (const g of groups) {
    g.items.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }
  return groups.filter((g) => g.items.length > 0);
}

function PortfolioCard({
  p,
  shares,
  marketValue,
  weightPct,
  sentimentThresholds,
  earningsRiskThresholds,
}: {
  p: PortfolioRow;
  shares: number | null;
  marketValue: number | null;
  weightPct: number | null;
  sentimentThresholds: Awaited<ReturnType<typeof getSentimentThresholds>>;
  earningsRiskThresholds: Awaited<ReturnType<typeof getEarningsRiskThresholds>>;
}) {
  const cashRow = isCashTicker(p.ticker);
  const cur = decToNum(p.currentPrice);
  const cost = decToNum(p.myAvgCost);
  const cashBal = cashRow ? notionCashBalanceUsd(p.currentPrice, p.myAvgCost) : 0;
  const per = cashRow ? { pct: null as number | null } : pnl(cur, cost);
  const pos = cashRow
    ? { dollar: null as number | null }
    : positionPnl(cur, cost, shares);
  const inEntry = !cashRow && priceInZone(p.currentPrice, p.entryZone);
  const inAdd = !cashRow && priceInZone(p.currentPrice, p.addZone);
  const derivedSentiment = sentimentFromScore(p.socialScore, sentimentThresholds);
  const derivedEarningsRisk = earningsRiskFromDays(
    p.daysToEarnings,
    earningsRiskThresholds,
  );
  const latestNote = newestNoteFromTexts(
    [
      hasReportBlocks(p.pageNotes)
        ? blocksToPlainText(asReportBlocks(p.pageNotes))
        : null,
    ],
    160,
  );

  return (
    <article className="card flex flex-col overflow-hidden h-full">
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-lg font-semibold tracking-wide tabular-nums text-gray-900">
              {fmtTicker(p.ticker)}
            </h3>
            {isCspxTicker(p.ticker) ? (
              <span className="badge bg-slate-100 text-slate-600">Passive</span>
            ) : null}
            {p.theme ? (
              <span className="text-[11px] text-gray-500 truncate">
                {themeLabel(p.theme)}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">
            {cashRow ? "Cash balance" : (p.company ?? "—")}
          </p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {inEntry ? (
              <span className="badge bg-sky-100 text-sky-800">In entry</span>
            ) : null}
            {inAdd ? (
              <span className="badge bg-emerald-100 text-emerald-800">In add zone</span>
            ) : null}
            {p.sleeve ? (
              <span className={`badge ${SLEEVE_CLASS[p.sleeve]}`}>
                {sleeveLabel(p.sleeve)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {p.action ? (
            <span className={`badge ${actionBadgeClass(p.action)}`}>
              {positionActionLabel(p.action)}
            </span>
          ) : null}
          {p.riskLevel ? (
            <span className={`badge ${riskBadgeClass(p.riskLevel)}`}>
              {riskLevelLabel(p.riskLevel)}
            </span>
          ) : null}
          {p.conviction != null ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Conv {p.conviction}/5
            </span>
          ) : null}
        </div>
      </div>

      <div className="mx-4 rounded-lg bg-gray-50 border border-gray-100 px-3 py-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {cashRow ? "Balance" : "Price"}
            </div>
            <div className="text-2xl font-semibold tabular-nums text-gray-900 leading-tight mt-0.5">
              {cashRow ? fmtMoney(cashBal > 0 ? cashBal : null) : fmtMoney(cur)}
            </div>
            {!cashRow && p.lastPriceUpdate ? (
              <div className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
                as of {fmtDayUtc(p.lastPriceUpdate)}
              </div>
            ) : null}
          </div>
          {!cashRow ? (
            <div className="text-right space-y-1.5">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Avg cost</div>
                <div className="text-sm font-medium tabular-nums text-gray-800">
                  {fmtMoney(cost)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Stop</div>
                <div className="text-sm font-medium tabular-nums text-gray-800">
                  {fmtMoney(decToNum(p.stopLoss))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {!cashRow ? (
          <div className="mt-3 pt-2.5 border-t border-gray-200/80 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                Shares
              </div>
              <div className="text-sm font-medium tabular-nums text-gray-800">
                {shares !== null ? fmtNum(shares, 0) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                Market value
              </div>
              <div className="text-sm font-medium tabular-nums text-gray-800">
                {fmtMoney(marketValue)}
              </div>
              {weightPct !== null ? (
                <div className="text-[10px] text-gray-400 tabular-nums">
                  {weightPct.toFixed(1)}% ex-CSPX
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                P&L
              </div>
              <div className={`text-sm font-semibold tabular-nums ${pnlToneClass(pos.dollar)}`}>
                {pos.dollar !== null ? fmtMoney(pos.dollar) : "—"}
              </div>
              <div className={`text-xs tabular-nums ${pnlToneClass(per.pct)}`}>
                {fmtPct(per.pct)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                Upside
              </div>
              <div
                className={`text-sm font-medium tabular-nums ${pnlToneClass(decToNum(p.upsidePct))}`}
              >
                {fmtPct(p.upsidePct)}
              </div>
            </div>
          </div>
        ) : null}

        {!cashRow && (p.daysToEarnings !== null || p.socialScore !== null || p.addsUsed != null) ? (
          <div className="mt-3 pt-2.5 border-t border-gray-200/80 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            {p.addsUsed != null ? (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Adds used</div>
                <div className="text-sm font-medium tabular-nums text-gray-800">
                  {p.addsUsed}
                </div>
              </div>
            ) : null}
            {p.daysToEarnings !== null ? (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Earnings</div>
                <div className="text-sm font-medium tabular-nums text-gray-800">
                  {p.daysToEarnings}d
                  <span className="text-gray-400 font-normal text-xs ml-1">
                    {fmtDayUtc(p.earningsDate)}
                  </span>
                </div>
                {derivedEarningsRisk ? (
                  <span
                    className={`badge mt-0.5 ${DERIVED_EARNINGS_RISK_CLASS[derivedEarningsRisk]}`}
                  >
                    {DERIVED_EARNINGS_RISK_LABEL[derivedEarningsRisk]}
                  </span>
                ) : null}
              </div>
            ) : null}
            {p.socialScore !== null ? (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Social</div>
                <div className="text-sm font-medium tabular-nums text-gray-800">
                  {p.socialScore}
                </div>
                {derivedSentiment ? (
                  <span className={`badge mt-0.5 ${DERIVED_SENTIMENT_CLASS[derivedSentiment]}`}>
                    {DERIVED_SENTIMENT_LABEL[derivedSentiment]}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="px-4 py-3 flex flex-col gap-3 flex-1">
        {(p.entryZone || p.addZone || p.nextAddTrigger) && (
          <dl className="space-y-1 text-xs leading-snug">
            {p.entryZone ? (
              <div>
                <dt className="text-gray-500 inline">Entry zone · </dt>
                <dd className="inline font-medium text-gray-800 tabular-nums">{p.entryZone}</dd>
              </div>
            ) : null}
            {p.addZone ? (
              <div>
                <dt className="text-gray-500 inline">Add zone · </dt>
                <dd className="inline font-medium text-gray-800 tabular-nums">{p.addZone}</dd>
              </div>
            ) : null}
            {p.nextAddTrigger ? (
              <div>
                <dt className="text-gray-500 inline">Next add · </dt>
                <dd className="inline font-medium text-gray-800">{p.nextAddTrigger}</dd>
              </div>
            ) : null}
          </dl>
        )}

        {hasReportBlocks(p.thesis) ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Thesis
            </div>
            <ReportBlocks blocks={asReportBlocks(p.thesis)} className="space-y-1.5 text-sm" />
          </div>
        ) : null}

        {p.keyRisk ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 mb-1">
              Key risk
            </div>
            <ExpandableText
              text={p.keyRisk}
              lines={2}
              textClassName="text-sm text-amber-900/90 whitespace-pre-wrap"
            />
          </div>
        ) : null}

        {latestNote ? (
          <div className="rounded-md border border-gray-100 bg-white px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Latest note
              </div>
              <div className="text-[10px] tabular-nums text-gray-400">
                {fmtShortDateUtc(latestNote.date)}
              </div>
            </div>
            <p className="text-xs text-gray-700 leading-snug line-clamp-3">
              {latestNote.preview}
            </p>
          </div>
        ) : null}
      </div>

      {hasReportBlocks(p.pageNotes) ? (
        <div className="mt-auto px-4 py-3 border-t border-gray-100 flex flex-wrap gap-2 bg-gray-50/40">
          <NotesModalField
            label="Notes"
            text={asReportBlocks(p.pageNotes)}
            context={fmtTicker(p.ticker)}
          />
        </div>
      ) : null}
    </article>
  );
}

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
  const totals = computePortfolioTotals(rows, trades);
  const exCspx = exCspxNavFromTotals(totals);
  const cashRow = rows.find((r) => isCashTicker(r.ticker)) ?? null;
  const equityRows = rows.filter((r) => !isCashTicker(r.ticker));
  const groups = groupByAction(equityRows);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-sm text-gray-500 mt-1">
          {equityRows.length} holdings
          {cashRow ? " + cash" : ""} — action columns (Exit → Hold), tickers A–Z. Notes open
          newest-first.
        </p>
      </section>

      <SyncStatusBanner status={status} />

      {rows.length > 0 ? (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Total value
            </div>
            <div className="text-xl font-semibold tabular-nums text-gray-900 mt-1">
              {fmtMoney(totals.totalValue)}
            </div>
          </div>
          <div className="card px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Equities
            </div>
            <div className="text-xl font-semibold tabular-nums text-gray-900 mt-1">
              {fmtMoney(totals.equitiesValue)}
            </div>
          </div>
          <div className="card px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Cash
            </div>
            <div className="text-xl font-semibold tabular-nums text-gray-900 mt-1">
              {fmtMoney(totals.cashValue)}
            </div>
          </div>
          <div className="card px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Unrealized P&L
            </div>
            <div
              className={`text-xl font-semibold tabular-nums mt-1 ${pnlToneClass(
                totals.hasPnl ? totals.unrealizedPnl : null,
              )}`}
            >
              {totals.hasPnl ? fmtMoney(totals.unrealizedPnl) : "—"}
            </div>
          </div>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <div className="card px-5 py-8 text-center text-gray-500">
          No holdings yet — run Update prices.
        </div>
      ) : null}

      {groups.length === 1 ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
              {groups[0]!.label}
            </h2>
            <span className="text-xs text-gray-500 tabular-nums">{groups[0]!.items.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {groups[0]!.items.map((p) => {
              const shares = resolvePositionShares(p, holdings);
              const cur = decToNum(p.currentPrice);
              const marketValue =
                shares !== null && cur !== null ? shares * cur : null;
              const weightPct = positionWeightPctExCspx(marketValue, p.ticker, exCspx);
              return (
                <PortfolioCard
                  key={p.id}
                  p={p}
                  shares={shares}
                  marketValue={marketValue}
                  weightPct={weightPct}
                  sentimentThresholds={sentimentThresholds}
                  earningsRiskThresholds={earningsRiskThresholds}
                />
              );
            })}
          </div>
        </section>
      ) : groups.length > 1 ? (
        <div className={`grid gap-4 ${actionGridClass(groups.length)}`}>
          {groups.map((g) => (
            <div key={g.label} className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 sticky top-0 z-10 bg-[#f7f7f8]/95 backdrop-blur-sm py-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                  {g.label}
                </h2>
                <span className="text-xs text-gray-500 tabular-nums">{g.items.length}</span>
              </div>
              <div className="space-y-3">
                {g.items.map((p) => {
                  const shares = resolvePositionShares(p, holdings);
                  const cur = decToNum(p.currentPrice);
                  const marketValue =
                    shares !== null && cur !== null ? shares * cur : null;
                  const weightPct = positionWeightPctExCspx(marketValue, p.ticker, exCspx);
                  return (
                    <PortfolioCard
                      key={p.id}
                      p={p}
                      shares={shares}
                      marketValue={marketValue}
                      weightPct={weightPct}
                      sentimentThresholds={sentimentThresholds}
                      earningsRiskThresholds={earningsRiskThresholds}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {cashRow ? (
        <section className="space-y-2 pt-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Cash</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            <PortfolioCard
              p={cashRow}
              shares={null}
              marketValue={totals.cashValue}
              weightPct={null}
              sentimentThresholds={sentimentThresholds}
              earningsRiskThresholds={earningsRiskThresholds}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function actionGridClass(count: number): string {
  if (count === 2) return "grid-cols-1 lg:grid-cols-2";
  if (count === 3) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
  if (count === 4) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";
  return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5";
}
