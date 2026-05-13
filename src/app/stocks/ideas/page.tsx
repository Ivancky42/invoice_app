import { getIdeas, getSyncStatus } from "@/lib/stocks/db";
import type { IdeaRow } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { ExpandableText } from "@/app/_components/ExpandableText";
import { decToNum, fmtMoney, fmtPct, riskBadgeClass } from "@/lib/stocks/format";

export const revalidate = 900;

const STATUS_ORDER = [
  "Researching",
  "Conviction Building",
  "Ready for Watchlist",
  "Add to Watchlist",
  "Hold Off",
  "Pass",
];

function statusBadge(s: string | null): string {
  switch (s) {
    case "Ready for Watchlist":
    case "Add to Watchlist":
      return "bg-emerald-100 text-emerald-800";
    case "Conviction Building":
      return "bg-blue-100 text-blue-700";
    case "Researching":
      return "bg-gray-100 text-gray-700";
    case "Hold Off":
      return "bg-amber-100 text-amber-800";
    case "Pass":
      return "bg-red-50 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function group(rows: IdeaRow[]) {
  const map = new Map<string, IdeaRow[]>();
  for (const r of rows) {
    const k = r.status ?? "Unsorted";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const ordered: { key: string; items: IdeaRow[] }[] = [];
  for (const k of STATUS_ORDER) if (map.has(k)) ordered.push({ key: k, items: map.get(k)! });
  for (const [k, items] of map) {
    if (!STATUS_ORDER.includes(k)) ordered.push({ key: k, items });
  }
  return ordered;
}

export default async function IdeasPage() {
  const [rows, status] = await Promise.all([getIdeas(), getSyncStatus()]);
  const groups = group(rows);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Ideas Pipeline</h1>
        <p className="text-sm text-gray-500">Research staging area before stocks graduate to the watchlist.</p>
      </section>

      <SyncStatusBanner status={status} />

      {rows.length === 0 && (
        <div className="card px-5 py-8 text-center text-gray-500">No ideas logged yet.</div>
      )}

      {groups.map((g) => (
        <section key={g.key} className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{g.key}</h2>
            <span className="text-xs text-gray-500">{g.items.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {g.items.map((i) => (
              <div key={i.notionId} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{i.stockSector}</div>
                    {i.theme && <div className="text-xs text-gray-500">{i.theme}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {i.status && (
                      <span className={`badge ${statusBadge(i.status)}`}>{i.status}</span>
                    )}
                    {i.riskLevel && (
                      <span className={`badge ${riskBadgeClass(i.riskLevel)}`}>{i.riskLevel}</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Price</div>
                    <div>{fmtMoney(decToNum(i.currentPrice))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Target</div>
                    <div>{fmtMoney(decToNum(i.analystTarget))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Upside</div>
                    <div>{fmtPct(i.upsidePct)}</div>
                  </div>
                </div>

                {i.whyInteresting && (
                  <ExpandableText
                    text={i.whyInteresting}
                    lines={3}
                    textClassName="text-sm text-gray-700 whitespace-pre-wrap"
                  />
                )}
                {i.socialBuzz && (
                  <div className="text-xs text-gray-500">
                    <strong>Buzz:</strong>
                    <ExpandableText
                      text={i.socialBuzz}
                      lines={2}
                      textClassName="whitespace-pre-wrap"
                    />
                  </div>
                )}
                {i.foundVia && (
                  <p className="text-xs text-gray-500">
                    <strong>Found via:</strong> {i.foundVia}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
