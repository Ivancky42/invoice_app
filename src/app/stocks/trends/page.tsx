import { getSyncStatus, getTrends } from "@/lib/stocks/db";
import type { TrendRow } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { ExpandableText } from "@/app/_components/ExpandableText";
import { decToNum, fmtPct } from "@/lib/stocks/format";

export const revalidate = 900;

const STAGES: Array<{ match: (s: string | null) => boolean; label: string }> = [
  { match: (s) => !!s && s.includes("Emerging"), label: "Emerging" },
  { match: (s) => !!s && s.includes("Building"), label: "Building" },
  { match: (s) => !!s && s.includes("Hot"), label: "Hot" },
  { match: (s) => !!s && s.includes("Peaked"), label: "Peaked" },
  { match: (s) => !!s && s.includes("Faded"), label: "Faded" },
  { match: (s) => !!s && s.includes("Paused"), label: "Paused" },
];

function bucketize(rows: TrendRow[]) {
  const buckets: Record<string, TrendRow[]> = {};
  for (const s of STAGES) buckets[s.label] = [];
  buckets["Other"] = [];
  for (const r of rows) {
    const s = STAGES.find((s) => s.match(r.lifecycleStage));
    if (s) buckets[s.label].push(r);
    else buckets["Other"].push(r);
  }
  return buckets;
}

function TrendCard({ t }: { t: TrendRow }) {
  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm leading-tight">{t.trendName}</div>
        {t.signalScore !== null && (
          <div className="text-xs font-semibold text-gray-700 bg-gray-100 rounded px-2 py-0.5">
            {t.signalScore}
          </div>
        )}
      </div>
      {t.themeSector && <div className="text-xs text-gray-500">{t.themeSector}</div>}
      {t.representativeTickers && (
        <div className="text-xs text-gray-700">{t.representativeTickers}</div>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {t.weekMomentum && (
          <div>
            <div className="text-gray-500">Week</div>
            <div>{t.weekMomentum}</div>
          </div>
        )}
        {t.verdict && (
          <div>
            <div className="text-gray-500">Verdict</div>
            <div>{t.verdict}</div>
          </div>
        )}
        {decToNum(t.perf1m) !== null && (
          <div>
            <div className="text-gray-500">1M</div>
            <div className={(decToNum(t.perf1m) ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"}>
              {fmtPct(t.perf1m)}
            </div>
          </div>
        )}
        {decToNum(t.perf3m) !== null && (
          <div>
            <div className="text-gray-500">3M</div>
            <div className={(decToNum(t.perf3m) ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"}>
              {fmtPct(t.perf3m)}
            </div>
          </div>
        )}
      </div>
      {t.keyCatalyst && (
        <div className="text-xs text-emerald-700">
          <strong>Catalyst:</strong>
          <ExpandableText
            text={t.keyCatalyst}
            lines={2}
            textClassName="whitespace-pre-wrap"
          />
        </div>
      )}
      {t.notes && (
        <div className="text-xs text-gray-600">
          <strong>Notes:</strong>
          <ExpandableText text={t.notes} lines={2} textClassName="whitespace-pre-wrap" />
        </div>
      )}
      {t.retrospective && (
        <div className="text-xs text-gray-600">
          <strong>Retrospective:</strong>
          <ExpandableText
            text={t.retrospective}
            lines={2}
            textClassName="whitespace-pre-wrap"
          />
        </div>
      )}
    </div>
  );
}

export default async function TrendsPage() {
  const [rows, status] = await Promise.all([getTrends(), getSyncStatus()]);
  const buckets = bucketize(rows);
  const visibleStages = [...STAGES.map((s) => s.label), "Other"].filter((l) => buckets[l].length > 0);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Trends</h1>
        <p className="text-sm text-gray-500">Lifecycle of every tracked sector / theme.</p>
      </section>

      <SyncStatusBanner status={status} />

      {rows.length === 0 ? (
        <div className="card px-5 py-8 text-center text-gray-500">No trends logged yet.</div>
      ) : visibleStages.length === 1 ? (
        // Only one stage populated — cards laid out in a normal grid so the
        // section uses the full width instead of one tall narrow column.
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
              {visibleStages[0]}
            </h2>
            <span className="text-xs text-gray-500">{buckets[visibleStages[0]].length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {buckets[visibleStages[0]].map((t) => (
              <TrendCard key={t.notionId} t={t} />
            ))}
          </div>
        </section>
      ) : (
        <div className={`grid gap-3 ${stageGridClass(visibleStages.length)}`}>
          {visibleStages.map((label) => (
            <div key={label} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{label}</h2>
                <span className="text-xs text-gray-500">{buckets[label].length}</span>
              </div>
              <div className="space-y-2">
                {buckets[label].map((t) => (
                  <TrendCard key={t.notionId} t={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// All Tailwind classes are spelled out as full literals so the JIT picks them
// up. Keep them in sync if you add new column counts.
function stageGridClass(count: number): string {
  switch (count) {
    case 2:
      return "grid-cols-1 sm:grid-cols-2";
    case 3:
      return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    case 4:
      return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
    case 5:
      return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
    case 6:
    default:
      return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6";
  }
}
