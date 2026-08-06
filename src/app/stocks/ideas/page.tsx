import { getIdeas, getSyncStatus } from "@/lib/stocks/db";
import type { IdeaRow } from "@/lib/stocks/db";
import { IdeaStage, IdeaStatus } from "@/generated/prisma/client";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { ExpandableText } from "@/app/_components/ExpandableText";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";
import { asReportBlocks, hasReportBlocks } from "@/lib/content/blocks";
import { decToNum, fmtMoney, fmtPct, fmtTicker, pnlToneClass, riskBadgeClass } from "@/lib/stocks/format";
import {
  IDEA_STAGE_CLASS,
  IDEA_STAGE_LABEL,
  IDEA_STATUS_CLASS,
  ideaStageLabel,
  ideaStatusLabel,
  riskLevelLabel,
  themeLabel,
} from "@/lib/stocks/labels";

export const revalidate = 900;

const STAGE_ORDER: Array<IdeaStage | null> = [
  IdeaStage.RADAR,
  IdeaStage.PRE_BUZZ,
  IdeaStage.EMERGING,
  IdeaStage.INSTITUTIONALIZING,
  IdeaStage.MAINSTREAM,
  null,
];

const STATUS_ORDER: Array<IdeaStatus | null> = [
  IdeaStatus.RESEARCHING,
  IdeaStatus.READY_FOR_WATCHLIST,
  IdeaStatus.HOLD_OFF,
  IdeaStatus.PASS,
  IdeaStatus.GRADUATED,
  null,
];

function groupByStage(rows: IdeaRow[]) {
  const map = new Map<IdeaStage | "unsorted", IdeaRow[]>();
  for (const r of rows) {
    const k = r.ideaStage ?? "unsorted";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const ordered: { key: string; items: IdeaRow[] }[] = [];
  for (const s of STAGE_ORDER) {
    const k = s ?? "unsorted";
    if (map.has(k)) {
      ordered.push({
        key: s ? IDEA_STAGE_LABEL[s] : "Unsorted",
        items: map.get(k)!,
      });
    }
  }
  return ordered;
}

function groupByStatus(rows: IdeaRow[]) {
  const map = new Map<IdeaStatus | "unsorted", IdeaRow[]>();
  for (const r of rows) {
    const k = r.status ?? "unsorted";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const ordered: { key: string; items: IdeaRow[] }[] = [];
  for (const s of STATUS_ORDER) {
    const k = s ?? "unsorted";
    if (map.has(k)) {
      ordered.push({
        key: s ? ideaStatusLabel(s) : "Unsorted",
        items: map.get(k)!,
      });
    }
  }
  return ordered;
}

function group(rows: IdeaRow[]) {
  const hasStage = rows.some((r) => r.ideaStage != null);
  return hasStage ? groupByStage(rows) : groupByStatus(rows);
}

export default async function IdeasPage() {
  const [rows, status] = await Promise.all([getIdeas(), getSyncStatus()]);
  const groups = group(rows);
  const groupedByStage = rows.some((r) => r.ideaStage != null);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Ideas Pipeline</h1>
        <p className="text-sm text-gray-500">
          Research staging area before stocks graduate to the watchlist
          {groupedByStage ? " — grouped by funnel stage." : "."}
        </p>
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
              <div key={i.id} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{i.stockSector}</div>
                    {i.leadTicker && (
                      <div className="text-xs text-gray-500 tracking-wide tabular-nums">
                        {fmtTicker(i.leadTicker)}
                      </div>
                    )}
                    {i.theme ? (
                      <div className="text-xs text-gray-500">{themeLabel(i.theme)}</div>
                    ) : i.themeRaw ? (
                      <div className="text-xs text-gray-400">{i.themeRaw}</div>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {i.ideaStage && (
                      <span className={`badge ${IDEA_STAGE_CLASS[i.ideaStage]}`}>
                        {ideaStageLabel(i.ideaStage)}
                      </span>
                    )}
                    {i.status && (
                      <span className={`badge ${IDEA_STATUS_CLASS[i.status]}`}>
                        {ideaStatusLabel(i.status)}
                      </span>
                    )}
                    {i.riskLevel && (
                      <span className={`badge ${riskBadgeClass(i.riskLevel)}`}>
                        {riskLevelLabel(i.riskLevel)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Price</div>
                    <div className="tabular-nums">{fmtMoney(decToNum(i.currentPrice))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Target</div>
                    <div className="tabular-nums">{fmtMoney(decToNum(i.analystTarget))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Upside</div>
                    <div className={`tabular-nums ${pnlToneClass(decToNum(i.upsidePct))}`}>
                      {fmtPct(i.upsidePct)}
                    </div>
                  </div>
                </div>

                {hasReportBlocks(i.whyInteresting) && (
                  <ReportBlocks blocks={asReportBlocks(i.whyInteresting)} className="space-y-2" />
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
