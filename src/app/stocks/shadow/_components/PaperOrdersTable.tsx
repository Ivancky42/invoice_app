import { fmtMoney, fmtPct, fmtTicker } from "@/lib/stocks/format";
import type { listShadowOrders } from "@/lib/shadow/read";
import { emptyRow, statusBadgeClass } from "./tableBits";

type Order = Awaited<ReturnType<typeof listShadowOrders>>["orders"][number];

type Props = {
  orders: Array<Order & { bookLabel: string }>;
};

export function PaperOrdersTable({ orders }: Props) {
  return (
    <section>
      <h3 className="font-medium px-5 pt-5">Paper orders</h3>
      <p className="text-xs text-gray-500 px-5 mt-0.5 mb-3">
        Simulated fills from decision reviews. BUY size is % of NAV; SELL size is % of the
        open position.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-2">Session</th>
              <th className="text-left px-5 py-2">Book</th>
              <th className="text-left px-5 py-2">Ticker</th>
              <th className="text-left px-5 py-2">Side</th>
              <th className="text-left px-5 py-2">Decision</th>
              <th className="text-right px-5 py-2">Size</th>
              <th className="text-right px-5 py-2">Fill</th>
              <th className="text-left px-5 py-2">Status</th>
              <th className="text-left px-5 py-2">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.length === 0 && emptyRow(9, "No paper orders yet.")}
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50 align-top">
                <td className="px-5 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                  {o.decisionSession ?? "—"}
                </td>
                <td className="px-5 py-3 text-xs text-gray-600">{o.bookLabel}</td>
                <td className="px-5 py-3 font-medium tracking-wide tabular-nums">
                  {fmtTicker(o.ticker)}
                </td>
                <td className="px-5 py-3">{o.side}</td>
                <td className="px-5 py-3 text-xs text-gray-600">{o.decisionType}</td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {o.sizeFraction != null && o.sizeFraction > 0 ? (
                    <>
                      {fmtPct(o.sizeFraction)}
                      <span className="block text-[10px] text-gray-400 font-normal">
                        {o.side === "SELL" ? "of position" : "of NAV"}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {o.fillPrice != null ? fmtMoney(o.fillPrice) : "—"}
                </td>
                <td className="px-5 py-3">
                  <span className={`badge ${statusBadgeClass(o.status)}`}>{o.status}</span>
                </td>
                <td className="px-5 py-3 text-xs text-gray-500 max-w-xs">
                  {o.rejectReason ??
                    (o.pendingSessions > 0 ? `pending ${o.pendingSessions} sess` : "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
