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
import { asReportBlocks, hasReportBlocks } from "@/lib/content/blocks";
import {
  decToNum,
  fmtDayUtc,
  fmtMoney,
  fmtPct,
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
  return groups.filter((g) => g.items.length > 0);
}

function UpsideBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400 text-xs">—</span>;
  const width = Math.min(100, Math.abs(pct) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-100 rounded">
        <div
          className={`h-2 rounded ${pct >= 0 ? "bg-emerald-400" : "bg-red-400"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums ${pnlToneClass(pct)}`}>{fmtPct(pct)}</span>
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

  return (
    <div
      className={`card p-4 flex flex-col gap-2 h-full ${demoted ? "opacity-70 border-dashed" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold tracking-wide tabular-nums">{fmtTicker(w.ticker)}</div>
          <div className="text-xs text-gray-500">{w.company ?? "—"}</div>
          {w.theme && (
            <div className="text-xs text-gray-500 mt-0.5">{themeLabel(w.theme)}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {w.action && (
            <span className={`badge ${WATCHLIST_ACTION_CLASS[w.action]}`}>
              {WATCHLIST_ACTION_LABEL[w.action]}
            </span>
          )}
          {w.priority && (
            <span className={`badge ${priorityBadgeClass(w.priority)}`}>
              {watchlistPriorityLabel(w.priority)}
            </span>
          )}
          {w.riskLevel && (
            <span className={`badge ${riskBadgeClass(w.riskLevel)}`}>
              {riskLevelLabel(w.riskLevel)}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-xs text-gray-500">Price</div>
          <div className="tabular-nums">{fmtMoney(decToNum(w.currentPrice))}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Target</div>
          <div className="tabular-nums">{fmtMoney(decToNum(w.analystTarget))}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Stop</div>
          <div className="tabular-nums">{fmtMoney(decToNum(w.stopLoss))}</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs gap-2">
        <div>
          <div className="text-gray-500">Upside</div>
          <UpsideBar pct={decToNum(w.upsidePct)} />
        </div>
        {w.socialScore !== null && (
          <div className="text-right">
            <div className="text-gray-500">Social</div>
            <div className="font-medium tabular-nums">{w.socialScore}</div>
            {derivedSentiment && (
              <span className={`badge mt-0.5 ${DERIVED_SENTIMENT_CLASS[derivedSentiment]}`}>
                {DERIVED_SENTIMENT_LABEL[derivedSentiment]}
              </span>
            )}
          </div>
        )}
        {w.daysToEarnings !== null && (
          <div className="text-right">
            <div className="text-gray-500">Earnings</div>
            <div className="font-medium tabular-nums">{w.daysToEarnings}d</div>
            <div className="text-[10px] text-gray-400">{fmtDayUtc(w.earningsDate)}</div>
            {derivedEarningsRisk && (
              <span className={`badge mt-0.5 ${DERIVED_EARNINGS_RISK_CLASS[derivedEarningsRisk]}`}>
                {DERIVED_EARNINGS_RISK_LABEL[derivedEarningsRisk]}
              </span>
            )}
          </div>
        )}
      </div>

      {w.entryZone && (
        <div className="text-xs">
          <span className="text-gray-500">Entry · </span>
          <span className="font-medium text-gray-800">{w.entryZone}</span>
        </div>
      )}
      {demoted && w.demotedAt && (
        <div className="text-xs text-gray-500">Demoted {fmtDayUtc(w.demotedAt)}</div>
      )}
      {hasReportBlocks(w.thesis) && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-gray-500">Thesis</div>
          <ReportBlocks blocks={asReportBlocks(w.thesis)} className="space-y-2" />
        </div>
      )}
      {w.keyCatalyst && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-emerald-700">Key catalyst</div>
          <ExpandableText
            text={w.keyCatalyst}
            lines={2}
            textClassName="text-sm text-emerald-800 whitespace-pre-wrap"
          />
        </div>
      )}
      {w.keyRisk && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-amber-700">Key risk</div>
          <ExpandableText
            text={w.keyRisk}
            lines={2}
            textClassName="text-sm text-amber-800 whitespace-pre-wrap"
          />
        </div>
      )}
      {(hasReportBlocks(w.pageNotes) || hasReportBlocks(w.actionNotes)) && (
        <div className="mt-auto pt-3 border-t border-gray-100 flex flex-wrap gap-2">
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
    </div>
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
  const demoted = rows.filter(isDemoted);
  const groups = groupByPriority(active);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-sm text-gray-500">
          Active names by priority. Soft-demoted rows are listed separately (§6).
        </p>
      </section>

      <SyncStatusBanner status={status} />

      {active.length === 0 && demoted.length === 0 && (
        <div className="card px-5 py-8 text-center text-gray-500">No watchlist entries yet.</div>
      )}

      {groups.map((g) => (
        <section key={g.label} className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{g.label}</h2>
            <span className="text-xs text-gray-500">{g.items.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {g.items.map((w) => (
              <WatchlistCard
                key={w.id}
                w={w}
                sentimentThresholds={sentimentThresholds}
                earningsRiskThresholds={earningsRiskThresholds}
              />
            ))}
          </div>
        </section>
      ))}

      {demoted.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-600">Demoted / dropped</h2>
            <span className="text-xs text-gray-500">{demoted.length}</span>
          </div>
          <p className="text-xs text-gray-500">
            Kept for re-promotion — not hard-deleted. Hidden from agent <code>get_context</code> by
            default.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
