import Link from "next/link";
import { fmtTicker } from "@/lib/stocks/format";
import type { listDecisionReviews } from "@/lib/agent/writes";
import { emptyRow, statusBadgeClass } from "./tableBits";

type Row = Awaited<ReturnType<typeof listDecisionReviews>>[number];

type Props = {
  decisions: Array<Row & { bookLabel: string }>;
};

export function DecisionReviewsTable({ decisions }: Props) {
  return (
    <section>
      <div className="px-5 pt-5 flex items-center justify-between">
        <div>
          <h3 className="font-medium">Decision reviews</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Shadow-branch subset (both paper books).
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-500">
            {decisions.length > 30
              ? `showing 30 of ${decisions.length}`
              : `${decisions.length} rows`}
          </span>
          <Link href="/stocks/decisions" className="text-sm hover:underline">
            All decisions
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto mt-3">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-2">Date</th>
              <th className="text-left px-5 py-2">Book</th>
              <th className="text-left px-5 py-2">Ticker</th>
              <th className="text-left px-5 py-2">Type</th>
              <th className="text-left px-5 py-2">Title</th>
              <th className="text-left px-5 py-2">Status</th>
              <th className="text-left px-5 py-2">Rules ver</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {decisions.length === 0 && emptyRow(7, "No paper decision reviews yet.")}
            {decisions.slice(0, 30).map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-5 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                  {d.decisionDate?.slice(0, 10) ?? "—"}
                </td>
                <td className="px-5 py-3 text-xs text-gray-600">{d.bookLabel}</td>
                <td className="px-5 py-3 font-medium tracking-wide tabular-nums">
                  {fmtTicker(d.ticker)}
                </td>
                <td className="px-5 py-3 text-xs text-gray-600">{d.decisionType ?? "—"}</td>
                <td className="px-5 py-3 text-gray-700 max-w-sm truncate">{d.title ?? "—"}</td>
                <td className="px-5 py-3">
                  {d.reviewStatus ? (
                    <span className={`badge ${statusBadgeClass(d.reviewStatus)}`}>
                      {d.reviewStatus}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-gray-500 font-mono truncate max-w-[7rem]">
                  {d.rulesVersion ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
