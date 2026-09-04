import { fmtTicker } from "@/lib/stocks/format";
import type { ShadowRejectedTrade } from "@/lib/shadow/summary";
import { emptyRow } from "./tableBits";

type Props = {
  orders: ShadowRejectedTrade[];
};

export function RejectedOrders({ orders }: Props) {
  return (
    <section>
      <h3 className="font-medium px-5 pt-5">Rejected orders</h3>
      <p className="text-xs text-gray-500 px-5 mt-0.5 mb-3">
        Last 10 rejected paper orders across both books, with the reason.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-2">Session</th>
              <th className="text-left px-5 py-2">Book</th>
              <th className="text-left px-5 py-2">Side</th>
              <th className="text-left px-5 py-2">Ticker</th>
              <th className="text-left px-5 py-2">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.length === 0 && emptyRow(5, "No rejected paper orders.")}
            {orders.map((o, i) => (
              <tr key={`${o.session}-${o.ticker}-${i}`} className="hover:bg-gray-50">
                <td className="px-5 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                  {o.session ?? "—"}
                </td>
                <td className="px-5 py-3 text-xs text-gray-600">{o.bookLabel}</td>
                <td className="px-5 py-3">{o.side}</td>
                <td className="px-5 py-3 font-medium tracking-wide tabular-nums">
                  {fmtTicker(o.ticker)}
                </td>
                <td className="px-5 py-3 text-xs text-gray-500">{o.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
