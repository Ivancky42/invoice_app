import { getSyncStatus, getTrends } from "@/lib/stocks/db";
import type { TrendRow } from "@/lib/stocks/db";
import { TrendStage } from "@/generated/prisma/client";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { ExpandableText } from "@/app/_components/ExpandableText";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";
import { asReportBlocks, hasReportBlocks } from "@/lib/content/blocks";
import { decToNum, fmtPctPoints, pnlToneClass } from "@/lib/stocks/format";
import {
  TREND_STAGE_LABEL,
  themeLabel,
  trendVerdictLabel,
  weekMomentumLabel,
} from "@/lib/stocks/labels";

export const revalidate = 900;

const STAGES: TrendStage[] = [
  TrendStage.EMERGING,
  TrendStage.BUILDING,
  TrendStage.HOT,
  TrendStage.PEAKED,
  TrendStage.FADED,
  TrendStage.PAUSED,
];

function bucketize(rows: TrendRow[]) {
  const buckets: Record<string, TrendRow[]> = {};
  for (const s of STAGES) buckets[s] = [];
  buckets["OTHER"] = [];
  for (const r of rows) {
    if (r.lifecycleStage && buckets[r.lifecycleStage]) {
      buckets[r.lifecycleStage]!.push(r);
    } else {
      buckets["OTHER"]!.push(r);
    }
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
      {t.theme ? (
        <div className="text-xs text-gray-500">{themeLabel(t.theme)}</div>
      ) : t.themeSectorRaw ? (
        <div className="text-xs text-gray-400">{t.themeSectorRaw}</div>
      ) : null}
      {t.representativeTickers && (
        <div className="text-xs text-gray-700">{t.representativeTickers}</div>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {t.weekMomentum && (
          <div>
            <div className="text-gray-500">Week</div>
            <div>{weekMomentumLabel(t.weekMomentum)}</div>
          </div>
        )}
        {t.verdict && (
          <div>
            <div className="text-gray-500">Verdict</div>
            <div>{trendVerdictLabel(t.verdict)}</div>
          </div>
        )}
        {decToNum(t.perf1m) !== null && (
          <div>
            <div className="text-gray-500">1M</div>
            <div className={`tabular-nums ${pnlToneClass(decToNum(t.perf1m))}`}>
              {fmtPctPoints(t.perf1m)}
            </div>
          </div>
        )}
        {decToNum(t.perf3m) !== null && (
          <div>
            <div className="text-gray-500">3M</div>
            <div className={`tabular-nums ${pnlToneClass(decToNum(t.perf3m))}`}>
              {fmtPctPoints(t.perf3m)}
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
      {hasReportBlocks(t.notes) && (
        <div className="text-xs text-gray-600 space-y-1">
          <strong>Notes:</strong>
          <ReportBlocks blocks={asReportBlocks(t.notes)} className="space-y-1" />
        </div>
      )}
      {hasReportBlocks(t.retrospective) && (
        <div className="text-xs text-gray-600 space-y-1">
          <strong>Retrospective:</strong>
          <ReportBlocks blocks={asReportBlocks(t.retrospective)} className="space-y-1" />
        </div>
      )}
    </div>
  );
}

export default async function TrendsPage() {
  const [rows, status] = await Promise.all([getTrends(), getSyncStatus()]);
  const buckets = bucketize(rows);
  const visibleKeys = [
    ...STAGES.filter((s) => buckets[s]!.length > 0),
    ...(buckets["OTHER"]!.length > 0 ? (["OTHER"] as const) : []),
  ];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Trends</h1>
        <p className="text-sm text-gray-500">Lifecycle of every tracked sector / theme.</p>
      </section>

      <SyncStatusBanner status={status} />

      {rows.length === 0 ? (
        <div className="card px-5 py-8 text-center text-gray-500">No trends logged yet.</div>
      ) : visibleKeys.length === 1 ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
              {visibleKeys[0] === "OTHER" ? "Other" : TREND_STAGE_LABEL[visibleKeys[0]]}
            </h2>
            <span className="text-xs text-gray-500">{buckets[visibleKeys[0]]!.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {buckets[visibleKeys[0]]!.map((t) => (
              <TrendCard key={t.id} t={t} />
            ))}
          </div>
        </section>
      ) : (
        <div className={`grid gap-3 ${stageGridClass(visibleKeys.length)}`}>
          {visibleKeys.map((key) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                  {key === "OTHER" ? "Other" : TREND_STAGE_LABEL[key]}
                </h2>
                <span className="text-xs text-gray-500">{buckets[key]!.length}</span>
              </div>
              <div className="space-y-2">
                {buckets[key]!.map((t) => (
                  <TrendCard key={t.id} t={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function stageGridClass(count: number): string {
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  if (count === 4) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
  if (count === 5) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6";
}
