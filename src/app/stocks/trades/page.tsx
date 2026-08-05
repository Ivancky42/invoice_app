import { getSyncStatus, getTrades } from "@/lib/stocks/db";
import type { TradeRow } from "@/lib/stocks/db";
import { TradeStatus } from "@/generated/prisma/client";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { asReportBlocks, blocksToPlainText, hasReportBlocks } from "@/lib/content/blocks";
import {
  decToNum,
  fmtMoney,
  fmtNum,
  fmtPct,
  tradeTypeBadgeClass,
} from "@/lib/stocks/format";
import { tradeStatusLabel, tradeTypeLabel } from "@/lib/stocks/labels";

export const revalidate = 900;

function notesPreview(notes: TradeRow["notes"]): string {
  if (!hasReportBlocks(notes)) return "—";
  const plain = blocksToPlainText(asReportBlocks(notes));
  return plain || "—";
}

function TradeTable({ rows }: { rows: TradeRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2">Date</th>
            <th className="text-left px-4 py-2">Ticker</th>
            <th className="text-left px-4 py-2">Type</th>
            <th className="text-right px-4 py-2">Price</th>
            <th className="text-right px-4 py-2">Shares</th>
            <th className="text-right px-4 py-2">Value</th>
            <th className="text-right px-4 py-2">P&L</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="text-left px-4 py-2">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((t) => {
            const pnlD = decToNum(t.pnlDollar);
            const pnlP = decToNum(t.pnlPct);
            return (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap">
                  {t.date ? t.date.toISOString().slice(0, 10) : "—"}
                </td>
                <td className="px-4 py-3 font-medium">{t.ticker ?? "—"}</td>
                <td className="px-4 py-3">
                  {t.type ? (
                    <span className={`badge ${tradeTypeBadgeClass(t.type)}`}>
                      {tradeTypeLabel(t.type)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-right">{fmtMoney(decToNum(t.pricePerShare))}</td>
                <td className="px-4 py-3 text-right">{fmtNum(decToNum(t.shares), 0)}</td>
                <td className="px-4 py-3 text-right">{fmtMoney(decToNum(t.totalValue))}</td>
                <td className="px-4 py-3 text-right">
                  {pnlD !== null ? (
                    <>
                      <div className={pnlD >= 0 ? "text-emerald-700" : "text-red-700"}>
                        {fmtMoney(pnlD)}
                      </div>
                      <div className="text-xs text-gray-500">{fmtPct(pnlP)}</div>
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">{tradeStatusLabel(t.status)}</td>
                <td className="px-4 py-3 text-xs text-gray-600 max-w-[20rem] truncate" title={notesPreview(t.notes)}>
                  {notesPreview(t.notes)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function TradesPage() {
  const [rows, status] = await Promise.all([getTrades(), getSyncStatus()]);
  const open = rows.filter(
    (t) => t.status === TradeStatus.OPEN || t.status === TradeStatus.PARTIAL,
  );
  const closed = rows.filter((t) => t.status === TradeStatus.CLOSED);
  const other = rows.filter((t) => !open.includes(t) && !closed.includes(t));

  let realized = 0;
  let realizedKnown = false;
  for (const t of closed) {
    const v = decToNum(t.pnlDollar);
    if (v !== null) {
      realized += v;
      realizedKnown = true;
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trades</h1>
          <p className="text-sm text-gray-500">All entries, exits, adds, trims.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Realized P&L (closed)</div>
          <div className={`text-2xl font-semibold ${realized >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {realizedKnown ? fmtMoney(realized) : "—"}
          </div>
        </div>
      </section>

      <SyncStatusBanner status={status} />

      {rows.length === 0 && (
        <div className="card px-5 py-8 text-center text-gray-500">No trades logged yet.</div>
      )}

      {open.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Open ({open.length})</h2>
          <TradeTable rows={open} />
        </section>
      )}

      {closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Closed ({closed.length})</h2>
          <TradeTable rows={closed} />
        </section>
      )}

      {other.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Other ({other.length})</h2>
          <TradeTable rows={other} />
        </section>
      )}
    </div>
  );
}
