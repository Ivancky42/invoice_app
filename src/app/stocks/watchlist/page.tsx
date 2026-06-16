import { getSyncStatus, getWatchlist } from "@/lib/stocks/db";
import type { WatchlistRow } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { ExpandableText } from "@/app/_components/ExpandableText";
import { NotesModalField } from "@/app/stocks/_components/NotesModalField";
import {
  decToNum,
  fmtMoney,
  fmtPct,
  priorityBadgeClass,
  riskBadgeClass,
} from "@/lib/stocks/format";

export const revalidate = 900;

const PRIORITY_ORDER: Array<{ match: (s: string | null) => boolean; label: string }> = [
  { match: (s) => !!s && s.includes("Buy now"), label: "Buy now" },
  { match: (s) => !!s && s.includes("Wait for entry"), label: "Wait for entry" },
  { match: (s) => !!s && s.includes("Watch"), label: "Watching" },
  { match: (s) => !!s && s.includes("Skip"), label: "Skip" },
  { match: (s) => !s, label: "Unsorted" },
];

function groupByPriority(rows: WatchlistRow[]) {
  const groups: { label: string; items: WatchlistRow[] }[] = PRIORITY_ORDER.map((g) => ({
    label: g.label,
    items: [],
  }));
  for (const r of rows) {
    const idx = PRIORITY_ORDER.findIndex((g) => g.match(r.priority));
    groups[idx === -1 ? PRIORITY_ORDER.length - 1 : idx].items.push(r);
  }
  return groups.filter((g) => g.items.length > 0);
}

function UpsideBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400 text-xs">—</span>;
  const positive = pct >= 0;
  const width = Math.min(100, Math.abs(pct) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-100 rounded">
        <div
          className={`h-2 rounded ${positive ? "bg-emerald-400" : "bg-red-400"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`text-xs ${positive ? "text-emerald-700" : "text-red-700"}`}>
        {fmtPct(pct)}
      </span>
    </div>
  );
}

export default async function WatchlistPage() {
  const [rows, status] = await Promise.all([getWatchlist(), getSyncStatus()]);
  const groups = groupByPriority(rows);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-sm text-gray-500">Stocks under consideration, grouped by priority.</p>
      </section>

      <SyncStatusBanner status={status} />

      {rows.length === 0 && (
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
              <div key={w.notionId} className="card p-4 flex flex-col gap-2 h-full">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{w.ticker}</div>
                    <div className="text-xs text-gray-500">{w.company ?? "—"}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {w.priority && (
                      <span className={`badge ${priorityBadgeClass(w.priority)}`}>{w.priority}</span>
                    )}
                    {w.riskLevel && (
                      <span className={`badge ${riskBadgeClass(w.riskLevel)}`}>{w.riskLevel}</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Price</div>
                    <div>{fmtMoney(decToNum(w.currentPrice))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Target</div>
                    <div>{fmtMoney(decToNum(w.analystTarget))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Bull</div>
                    <div>{fmtMoney(decToNum(w.bullTarget))}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <div>
                    <div className="text-gray-500">Upside</div>
                    <UpsideBar pct={decToNum(w.upsidePct)} />
                  </div>
                  {w.socialScore !== null && (
                    <div className="text-right">
                      <div className="text-gray-500">Social</div>
                      <div className="font-medium">{w.socialScore}</div>
                    </div>
                  )}
                  {w.daysToEarnings !== null && (
                    <div className="text-right">
                      <div className="text-gray-500">Earnings</div>
                      <div className="font-medium">{w.daysToEarnings}d</div>
                    </div>
                  )}
                </div>

                {w.entryZone && (
                  <div className="text-xs">
                    <span className="text-gray-500">Entry: </span>
                    <span className="font-medium">{w.entryZone}</span>
                  </div>
                )}
                {w.thesis && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-gray-500">Thesis</div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{w.thesis}</p>
                  </div>
                )}
                {w.impliedMove && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-gray-500">Implied move</div>
                    <ExpandableText
                      text={w.impliedMove}
                      lines={2}
                      textClassName="text-sm text-gray-700 whitespace-pre-wrap"
                    />
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
                {w.socialPlatformBuzz && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-gray-500">Social platform</div>
                    <ExpandableText
                      text={w.socialPlatformBuzz}
                      lines={3}
                      textClassName="text-sm text-gray-700 whitespace-pre-wrap"
                    />
                  </div>
                )}
                {(w.pageNotes || w.actionNotes) && (
                  <div className="mt-auto pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                    {w.pageNotes && (
                      <NotesModalField label="Notes" text={w.pageNotes} context={w.ticker} />
                    )}
                    {w.actionNotes && (
                      <NotesModalField
                        label="Action notes"
                        text={w.actionNotes}
                        context={w.ticker}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
