import { getSyncStatus, getWatchlist } from "@/lib/stocks/db";
import type { WatchlistRow } from "@/lib/stocks/db";
import {
  getEarningsRiskThresholds,
  getSentimentThresholds,
} from "@/lib/stocks/config";
import { WatchlistPriority } from "@/generated/prisma/client";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { ExpandableText } from "@/app/_components/ExpandableText";
import { NotesModalField } from "@/app/stocks/_components/NotesModalField";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";
import { asReportBlocks, blocksToPlainText, hasReportBlocks } from "@/lib/content/blocks";
import {
  decToNum,
  fmtDayUtc,
  fmtMoney,
  fmtPct,
  fmtShortDateUtc,
  fmtTicker,
  pnlToneClass,
  priorityBadgeClass,
  riskBadgeClass,
} from "@/lib/stocks/format";
import {
  DERIVED_EARNINGS_RISK_CLASS,
  DERIVED_EARNINGS_RISK_LABEL,
  DERIVED_SENTIMENT_CLASS,
  DERIVED_SENTIMENT_LABEL,
  riskLevelLabel,
  themeLabel,
  watchlistPriorityLabel,
  WATCHLIST_ACTION_CLASS,
  WATCHLIST_ACTION_LABEL,
  WATCHLIST_PRIORITY_LABEL,
} from "@/lib/stocks/labels";
import { earningsRiskFromDays, sentimentFromScore } from "@/lib/stocks/derived";
import { newestNoteFromTexts } from "@/lib/stocks/parseStockNotes";

export const revalidate = 900;

const PRIORITY_ORDER: Array<WatchlistPriority | null> = [
  WatchlistPriority.BUY_NOW,
  WatchlistPriority.WAIT_FOR_ENTRY,
  WatchlistPriority.WATCH,
  WatchlistPriority.SKIP_FOR_NOW,
  null,
];

function isDemoted(w: WatchlistRow): boolean {
  return w.action === "DEMOTED" || w.action === "DROPPED";
}

function groupByPriority(rows: WatchlistRow[]) {
  const groups: { key: WatchlistPriority | null; label: string; items: WatchlistRow[] }[] =
    PRIORITY_ORDER.map((key) => ({
      key,
      label: key ? WATCHLIST_PRIORITY_LABEL[key] : "Unsorted",
      items: [],
    }));
  for (const r of rows) {
    const idx = PRIORITY_ORDER.indexOf(r.priority);
    groups[idx === -1 ? PRIORITY_ORDER.length - 1 : idx]!.items.push(r);
  }
  for (const g of groups) {
    g.items.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }
  return groups.filter((g) => g.items.length > 0);
}

function UpsideBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400 text-xs tabular-nums">—</span>;
  const width = Math.min(100, Math.abs(pct) * 100);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-16 sm:w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full ${pct >= 0 ? "bg-emerald-500" : "bg-red-400"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums font-medium ${pnlToneClass(pct)}`}>
        {fmtPct(pct)}
      </span>
    </div>
  );
}

function WatchlistCard({
  w,
  sentimentThresholds,
  earningsRiskThresholds,
}: {
  w: WatchlistRow;
  sentimentThresholds: Awaited<ReturnType<typeof getSentimentThresholds>>;
  earningsRiskThresholds: Awaited<ReturnType<typeof getEarningsRiskThresholds>>;
}) {
  const derivedSentiment = sentimentFromScore(w.socialScore, sentimentThresholds);
  const derivedEarningsRisk = earningsRiskFromDays(w.daysToEarnings, earningsRiskThresholds);
  const demoted = isDemoted(w);
  const price = decToNum(w.currentPrice);
  const target = decToNum(w.analystTarget);
  const stop = decToNum(w.stopLoss);
  const upside = decToNum(w.upsidePct);

  const noteTexts = [
    hasReportBlocks(w.pageNotes) ? blocksToPlainText(asReportBlocks(w.pageNotes)) : null,
  ];
  const latestNote = newestNoteFromTexts(noteTexts, 160);

  return (
    <article
      className={`card flex flex-col overflow-hidden h-full ${
        demoted ? "opacity-70 border-dashed" : ""
      }`}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-lg font-semibold tracking-wide tabular-nums text-gray-900">
              {fmtTicker(w.ticker)}
            </h3>
            {w.theme ? (
              <span className="text-[11px] text-gray-500 truncate">{themeLabel(w.theme)}</span>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">{w.company ?? "—"}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {w.action ? (
            <span className={`badge ${WATCHLIST_ACTION_CLASS[w.action]}`}>
              {WATCHLIST_ACTION_LABEL[w.action]}
            </span>
          ) : null}
          {w.priority ? (
            <span className={`badge ${priorityBadgeClass(w.priority)}`}>
              {watchlistPriorityLabel(w.priority)}
            </span>
          ) : null}
          {w.riskLevel ? (
            <span className={`badge ${riskBadgeClass(w.riskLevel)}`}>
              {riskLevelLabel(w.riskLevel)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Price strip */}
      <div className="mx-4 rounded-lg bg-gray-50 border border-gray-100 px-3 py-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Price
            </div>
            <div className="text-2xl font-semibold tabular-nums text-gray-900 leading-tight mt-0.5">
              {fmtMoney(price)}
            </div>
          </div>
          <div className="text-right space-y-1.5">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Target</div>
              <div className="text-sm font-medium tabular-nums text-gray-800">{fmtMoney(target)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Stop</div>
              <div className="text-sm font-medium tabular-nums text-gray-800">{fmtMoney(stop)}</div>
            </div>
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-gray-200/80 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Upside</div>
            <UpsideBar pct={upside} />
          </div>
          {w.daysToEarnings !== null ? (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Earnings</div>
              <div className="text-sm font-medium tabular-nums text-gray-800">
                {w.daysToEarnings}d
                <span className="text-gray-400 font-normal text-xs ml-1">
                  {fmtDayUtc(w.earningsDate)}
                </span>
              </div>
              {derivedEarningsRisk ? (
                <span className={`badge mt-0.5 ${DERIVED_EARNINGS_RISK_CLASS[derivedEarningsRisk]}`}>
                  {DERIVED_EARNINGS_RISK_LABEL[derivedEarningsRisk]}
                </span>
              ) : null}
            </div>
          ) : null}
          {w.socialScore !== null ? (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Social</div>
              <div className="text-sm font-medium tabular-nums text-gray-800">{w.socialScore}</div>
              {derivedSentiment ? (
                <span className={`badge mt-0.5 ${DERIVED_SENTIMENT_CLASS[derivedSentiment]}`}>
                  {DERIVED_SENTIMENT_LABEL[derivedSentiment]}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Zones + body */}
      <div className="px-4 py-3 flex flex-col gap-3 flex-1">
        {w.entryZone ? (
          <div className="text-xs leading-snug">
            <span className="text-gray-500">Entry zone · </span>
            <span className="font-medium text-gray-800 tabular-nums">{w.entryZone}</span>
          </div>
        ) : null}

        {demoted && w.demotedAt ? (
          <div className="text-xs text-gray-500">Demoted {fmtDayUtc(w.demotedAt)}</div>
        ) : null}

        {hasReportBlocks(w.thesis) ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Thesis
            </div>
            <ReportBlocks blocks={asReportBlocks(w.thesis)} className="space-y-1.5 text-sm" />
          </div>
        ) : null}

        {w.keyCatalyst ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1">
              Key catalyst
            </div>
            <ExpandableText
              text={w.keyCatalyst}
              lines={2}
              textClassName="text-sm text-emerald-900/90 whitespace-pre-wrap"
            />
          </div>
        ) : null}

        {w.keyRisk ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 mb-1">
              Key risk
            </div>
            <ExpandableText
              text={w.keyRisk}
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
            <p className="text-xs text-gray-700 leading-snug line-clamp-3">{latestNote.preview}</p>
          </div>
        ) : null}
      </div>

      {/* Footer actions */}
      {(hasReportBlocks(w.pageNotes) || hasReportBlocks(w.actionNotes)) && (
        <div className="mt-auto px-4 py-3 border-t border-gray-100 flex flex-wrap gap-2 bg-gray-50/40">
          {hasReportBlocks(w.pageNotes) && (
            <NotesModalField
              label="Notes"
              text={asReportBlocks(w.pageNotes)}
              context={fmtTicker(w.ticker)}
            />
          )}
          {hasReportBlocks(w.actionNotes) && (
            <NotesModalField
              label="Action notes"
              text={asReportBlocks(w.actionNotes)}
              context={fmtTicker(w.ticker)}
            />
          )}
        </div>
      )}
    </article>
  );
}

export default async function WatchlistPage() {
  const [rows, status, sentimentThresholds, earningsRiskThresholds] = await Promise.all([
    getWatchlist(),
    getSyncStatus(),
    getSentimentThresholds(),
    getEarningsRiskThresholds(),
  ]);
  const active = rows.filter((w) => !isDemoted(w));
  const demoted = rows.filter(isDemoted).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const groups = groupByPriority(active);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-sm text-gray-500 mt-1">
          {active.length} active
          {demoted.length > 0 ? ` · ${demoted.length} demoted` : ""} — priority columns,
          tickers A–Z. Notes open newest-first.
        </p>
      </section>

      <SyncStatusBanner status={status} />

      {active.length === 0 && demoted.length === 0 && (
        <div className="card px-5 py-8 text-center text-gray-500">No watchlist entries yet.</div>
      )}

      {groups.length === 1 ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
              {groups[0]!.label}
            </h2>
            <span className="text-xs text-gray-500 tabular-nums">{groups[0]!.items.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {groups[0]!.items.map((w) => (
              <WatchlistCard
                key={w.id}
                w={w}
                sentimentThresholds={sentimentThresholds}
                earningsRiskThresholds={earningsRiskThresholds}
              />
            ))}
          </div>
        </section>
      ) : groups.length > 1 ? (
        <div className={`grid gap-4 ${priorityGridClass(groups.length)}`}>
          {groups.map((g) => (
            <div key={g.label} className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 sticky top-0 z-10 bg-[#f7f7f8]/95 backdrop-blur-sm py-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                  {g.label}
                </h2>
                <span className="text-xs text-gray-500 tabular-nums">{g.items.length}</span>
              </div>
              <div className="space-y-3">
                {g.items.map((w) => (
                  <WatchlistCard
                    key={w.id}
                    w={w}
                    sentimentThresholds={sentimentThresholds}
                    earningsRiskThresholds={earningsRiskThresholds}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {demoted.length > 0 && (
        <section className="space-y-3 pt-2">
          <div className="flex items-baseline gap-2 border-b border-gray-100 pb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              Demoted / dropped
            </h2>
            <span className="text-xs text-gray-500 tabular-nums">{demoted.length}</span>
          </div>
          <p className="text-xs text-gray-500">
            Kept for re-promotion — not hard-deleted. Hidden from agent <code>get_context</code> by
            default.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {demoted.map((w) => (
              <WatchlistCard
                key={w.id}
                w={w}
                sentimentThresholds={sentimentThresholds}
                earningsRiskThresholds={earningsRiskThresholds}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function priorityGridClass(count: number): string {
  if (count === 2) return "grid-cols-1 lg:grid-cols-2";
  if (count === 3) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
  if (count === 4) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";
  return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5";
}
