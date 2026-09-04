import { fmtMoney, pnlToneClass } from "@/lib/stocks/format";
import type { getShadowFitness } from "@/lib/fitness/read";
import { emptyRow, fmtSignedFrac } from "./tableBits";

type Row = Awaited<ReturnType<typeof getShadowFitness>>["snapshots"][number];

type Props = {
  snapshots: Array<Row & { bookLabel: string }>;
};

export function FitnessSnapshotsTable({ snapshots }: Props) {
  return (
    <section>
      <h3 className="font-medium px-5 pt-5">Fitness snapshots</h3>
      <p className="text-xs text-gray-500 px-5 mt-0.5 mb-3">
        Daily increments are fractions of NAV. Fitness Δ = daily + avoided − turnover −
        CSPX. <em>avoidedCreditDelta</em> is signed.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-2">Session</th>
              <th className="text-left px-5 py-2">Book</th>
              <th className="text-right px-5 py-2">NAV</th>
              <th className="text-right px-5 py-2">Daily</th>
              <th className="text-right px-5 py-2">Avoided</th>
              <th className="text-right px-5 py-2">CSPX</th>
              <th className="text-right px-5 py-2">Fitness Δ</th>
              <th className="text-right px-5 py-2">Window</th>
              <th className="text-left px-5 py-2">Quality</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {snapshots.length === 0 && emptyRow(9, "No fitness snapshots yet.")}
            {snapshots.slice(0, 30).map((s, i) => (
              <tr key={`${s.bookLabel}-${s.session ?? "sess"}-${i}`} className="hover:bg-gray-50">
                <td className="px-5 py-3 text-xs text-gray-500 tabular-nums">
                  {s.session ?? "—"}
                </td>
                <td className="px-5 py-3 text-xs text-gray-600">{s.bookLabel}</td>
                <td className="px-5 py-3 text-right tabular-nums">{fmtMoney(s.nav)}</td>
                <td
                  className={`px-5 py-3 text-right tabular-nums ${pnlToneClass(s.dailyIncrement)}`}
                >
                  {fmtSignedFrac(s.dailyIncrement)}
                </td>
                <td
                  className={`px-5 py-3 text-right tabular-nums ${pnlToneClass(s.avoidedCreditDelta)}`}
                >
                  {fmtSignedFrac(s.avoidedCreditDelta)}
                </td>
                <td
                  className={`px-5 py-3 text-right tabular-nums ${pnlToneClass(s.benchmarkIncrement)}`}
                >
                  {fmtSignedFrac(s.benchmarkIncrement)}
                </td>
                <td
                  className={`px-5 py-3 text-right tabular-nums font-medium ${pnlToneClass(s.fitnessIncrement)}`}
                >
                  {fmtSignedFrac(s.fitnessIncrement)}
                </td>
                <td
                  className={`px-5 py-3 text-right tabular-nums ${pnlToneClass(s.windowFitness)}`}
                >
                  {fmtSignedFrac(s.windowFitness)}
                </td>
                <td className="px-5 py-3">
                  <span className="badge bg-gray-100 text-gray-700">{s.quality}</span>
                  {s.staleMarks > 0 ? (
                    <span className="ml-1 text-xs text-amber-700">{s.staleMarks} stale</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
