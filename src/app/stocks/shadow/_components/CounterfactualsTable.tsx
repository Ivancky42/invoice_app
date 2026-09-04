import { fmtTicker, pnlToneClass } from "@/lib/stocks/format";
import type { listCounterfactuals } from "@/lib/fitness/read";
import { emptyRow, fmtSignedFrac, statusBadgeClass } from "./tableBits";

type Row = Awaited<ReturnType<typeof listCounterfactuals>>["counterfactuals"][number];

type Props = {
  counterfactuals: Array<Row & { bookLabel: string }>;
};

export function CounterfactualsTable({ counterfactuals }: Props) {
  return (
    <section>
      <h3 className="font-medium px-5 pt-5">Counterfactuals</h3>
      <p className="text-xs text-gray-500 px-5 mt-0.5 mb-3">
        What refused decisions (AVOID / WAIT / DO_NOT_AVERAGE_DOWN) would have been worth.
        Credit is signed: refusing a name that fell credits you; refusing one that rose
        debits you.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-2">Decision</th>
              <th className="text-left px-5 py-2">Book</th>
              <th className="text-left px-5 py-2">Ticker</th>
              <th className="text-left px-5 py-2">Type</th>
              <th className="text-right px-5 py-2">Horizon ret</th>
              <th className="text-right px-5 py-2">Credit</th>
              <th className="text-left px-5 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {counterfactuals.length === 0 &&
              emptyRow(7, "No counterfactuals seeded yet.")}
            {counterfactuals.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-5 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                  {c.decisionSession ?? "—"}
                </td>
                <td className="px-5 py-3 text-xs text-gray-600">{c.bookLabel}</td>
                <td className="px-5 py-3 font-medium tracking-wide tabular-nums">
                  {fmtTicker(c.ticker)}
                </td>
                <td className="px-5 py-3 text-xs text-gray-600">{c.decisionType}</td>
                <td
                  className={`px-5 py-3 text-right tabular-nums ${pnlToneClass(c.horizonReturn)}`}
                >
                  {fmtSignedFrac(c.horizonReturn)}
                </td>
                <td
                  className={`px-5 py-3 text-right tabular-nums font-medium ${pnlToneClass(c.credit)}`}
                >
                  {fmtSignedFrac(c.credit)}
                </td>
                <td className="px-5 py-3">
                  <span className={`badge ${statusBadgeClass(c.status)}`}>{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
