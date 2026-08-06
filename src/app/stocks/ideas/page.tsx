import { getIdeas, getSyncStatus } from "@/lib/stocks/db";
import type { IdeaRow } from "@/lib/stocks/db";
import { IdeaStatus } from "@/generated/prisma/client";
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
  decToNum,
  fmtDayUtc,
  fmtMoney,
  fmtPct,
  fmtShortDateUtc,
  fmtTicker,
  pnlToneClass,
  riskBadgeClass,
} from "@/lib/stocks/format";
import {
  IDEA_STAGE_CLASS,
  IDEA_STATUS_CLASS,
  IDEA_STATUS_LABEL,
  ideaStageLabel,
  ideaStatusLabel,
  riskLevelLabel,
  themeLabel,
} from "@/lib/stocks/labels";
import { newestNoteFromTexts } from "@/lib/stocks/parseStockNotes";

export const revalidate = 900;

/** Pipeline order — active work left, closed right. */
const STATUS_ORDER: Array<IdeaStatus | null> = [
  IdeaStatus.READY_FOR_WATCHLIST,
  IdeaStatus.RESEARCHING,
  IdeaStatus.HOLD_OFF,
  IdeaStatus.GRADUATED,
  IdeaStatus.PASS,
  null,
];

function groupByStatus(rows: IdeaRow[]) {
  const groups: { key: IdeaStatus | null; label: string; items: IdeaRow[] }[] =
    STATUS_ORDER.map((key) => ({
      key,
      label: key ? IDEA_STATUS_LABEL[key] : "Unsorted",
      items: [],
    }));

  for (const r of rows) {
    const idx = STATUS_ORDER.indexOf(r.status);
    groups[idx === -1 ? STATUS_ORDER.length - 1 : idx]!.items.push(r);
  }
  for (const g of groups) {
    g.items.sort((a, b) => {
      const aKey = (a.leadTicker || a.stockSector).toUpperCase();
      const bKey = (b.leadTicker || b.stockSector).toUpperCase();
      return aKey.localeCompare(bKey);
    });
  }
  return groups.filter((g) => g.items.length > 0);
}

function statusGridClass(count: number): string {
  if (count === 2) return "grid-cols-1 lg:grid-cols-2";
  if (count === 3) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
  if (count === 4) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";
  return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5";
}

function IdeaCard({ idea }: { idea: IdeaRow }) {
  const price = decToNum(idea.currentPrice);
  const target = decToNum(idea.analystTarget);
  const upside = decToNum(idea.upsidePct);
  const priceUnreliable = !idea.leadTicker && price !== null;

  const latestNote = newestNoteFromTexts(
    [
      hasReportBlocks(idea.notes)
        ? blocksToPlainText(asReportBlocks(idea.notes))
        : null,
      hasReportBlocks(idea.whyInteresting)
        ? blocksToPlainText(asReportBlocks(idea.whyInteresting))
        : null,
    ],
    140,
  );

  return (
    <article className="card flex flex-col overflow-hidden h-full">
      <div className="px-3.5 pt-3.5 pb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {idea.leadTicker ? (
            <div className="text-base font-semibold tracking-wide tabular-nums text-gray-900">
              {fmtTicker(idea.leadTicker)}
            </div>
          ) : null}
          <h3
            className={`font-medium text-gray-900 leading-snug ${
              idea.leadTicker ? "text-xs text-gray-600 mt-0.5" : "text-sm"
            }`}
          >
            {idea.stockSector}
          </h3>
          {idea.theme ? (
            <div className="text-[11px] text-gray-500 mt-0.5 truncate">
              {themeLabel(idea.theme)}
            </div>
          ) : idea.themeRaw ? (
            <div className="text-[11px] text-gray-400 mt-0.5 truncate">{idea.themeRaw}</div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {idea.status ? (
            <span className={`badge ${IDEA_STATUS_CLASS[idea.status]}`}>
              {ideaStatusLabel(idea.status)}
            </span>
          ) : null}
          {idea.ideaStage ? (
            <span className={`badge ${IDEA_STAGE_CLASS[idea.ideaStage]}`}>
              {ideaStageLabel(idea.ideaStage)}
            </span>
          ) : null}
          {idea.riskLevel ? (
            <span className={`badge ${riskBadgeClass(idea.riskLevel)}`}>
              {riskLevelLabel(idea.riskLevel)}
            </span>
          ) : null}
        </div>
      </div>

      {(price !== null || target !== null || upside !== null) && (
        <div className="mx-3.5 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2.5">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Price</div>
              <div className="text-sm font-semibold tabular-nums text-gray-900">
                {fmtMoney(price)}
              </div>
              {priceUnreliable ? (
                <div className="text-[10px] text-amber-600 leading-tight mt-0.5">Unreliable</div>
              ) : null}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Target</div>
              <div className="text-sm font-medium tabular-nums text-gray-800">
                {fmtMoney(target)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Upside</div>
              <div className={`text-sm font-medium tabular-nums ${pnlToneClass(upside)}`}>
                {fmtPct(idea.upsidePct)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-3.5 py-2.5 flex flex-col gap-2.5 flex-1">
        {(idea.catalystDate || idea.dateFound || idea.lastReviewed || idea.graduationDate) && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500 tabular-nums">
            {idea.catalystDate ? (
              <span>
                Catalyst <span className="text-gray-700">{fmtDayUtc(idea.catalystDate)}</span>
              </span>
            ) : null}
            {idea.lastReviewed ? (
              <span>
                Reviewed <span className="text-gray-700">{fmtDayUtc(idea.lastReviewed)}</span>
              </span>
            ) : null}
            {idea.dateFound ? (
              <span>
                Found <span className="text-gray-700">{fmtDayUtc(idea.dateFound)}</span>
              </span>
            ) : null}
            {idea.graduationDate ? (
              <span>
                Graduated <span className="text-gray-700">{fmtDayUtc(idea.graduationDate)}</span>
                {decToNum(idea.graduationPrice) !== null
                  ? ` @ ${fmtMoney(decToNum(idea.graduationPrice))}`
                  : ""}
              </span>
            ) : null}
          </div>
        )}

        {hasReportBlocks(idea.whyInteresting) ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Why interesting
            </div>
            <ReportBlocks
              blocks={asReportBlocks(idea.whyInteresting)}
              className="space-y-1 text-sm text-gray-800"
            />
          </div>
        ) : null}

        {idea.socialBuzz ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Buzz
            </div>
            <ExpandableText
              text={idea.socialBuzz}
              lines={2}
              textClassName="text-xs text-gray-600 whitespace-pre-wrap"
            />
          </div>
        ) : null}

        {idea.keyRisk ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 mb-1">
              Key risk
            </div>
            <ExpandableText
              text={idea.keyRisk}
              lines={2}
              textClassName="text-xs text-amber-900/90 whitespace-pre-wrap"
            />
          </div>
        ) : null}

        {idea.foundVia ? (
          <p className="text-[11px] text-gray-500">
            <span className="text-gray-400">Found via · </span>
            {idea.foundVia}
          </p>
        ) : null}

        {latestNote && hasReportBlocks(idea.notes) ? (
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

      {hasReportBlocks(idea.notes) ? (
        <div className="mt-auto px-3.5 py-2.5 border-t border-gray-100 bg-gray-50/40">
          <NotesModalField
            label="Notes"
            text={asReportBlocks(idea.notes)}
            context={fmtTicker(idea.leadTicker) !== "—" ? fmtTicker(idea.leadTicker) : idea.stockSector}
          />
        </div>
      ) : null}
    </article>
  );
}

export default async function IdeasPage() {
  const [rows, status] = await Promise.all([getIdeas(), getSyncStatus()]);
  const groups = groupByStatus(rows);
  const activeCount = rows.filter(
    (r) => r.status === "RESEARCHING" || r.status === "READY_FOR_WATCHLIST" || r.status === "HOLD_OFF",
  ).length;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Ideas Pipeline</h1>
        <p className="text-sm text-gray-500 mt-1">
          {rows.length} ideas · {activeCount} active — status columns, A–Z. Research staging
          before watchlist graduation.
        </p>
      </section>

      <SyncStatusBanner status={status} />

      {rows.length === 0 ? (
        <div className="card px-5 py-8 text-center text-gray-500">No ideas logged yet.</div>
      ) : groups.length === 1 ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
              {groups[0]!.label}
            </h2>
            <span className="text-xs text-gray-500 tabular-nums">{groups[0]!.items.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {groups[0]!.items.map((i) => (
              <IdeaCard key={i.id} idea={i} />
            ))}
          </div>
        </section>
      ) : (
        <div className={`grid gap-4 ${statusGridClass(groups.length)}`}>
          {groups.map((g) => (
            <div key={g.label} className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 sticky top-0 z-10 bg-[#f7f7f8]/95 backdrop-blur-sm py-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                  {g.label}
                </h2>
                <span className="text-xs text-gray-500 tabular-nums">{g.items.length}</span>
              </div>
              <div className="space-y-3">
                {g.items.map((i) => (
                  <IdeaCard key={i.id} idea={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
