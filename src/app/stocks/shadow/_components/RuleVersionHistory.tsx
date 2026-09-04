import type { listRuleVersions } from "@/lib/evolution/read";
import { emptyRow, statusBadgeClass } from "./tableBits";

type Props = {
  versions: Awaited<ReturnType<typeof listRuleVersions>>["ruleVersions"];
};

export function RuleVersionHistory({ versions }: Props) {
  return (
    <section>
      <h3 className="font-medium px-5 pt-5">Rule version history</h3>
      <p className="text-xs text-gray-500 px-5 mt-0.5 mb-3">
        Metadata only — prompt text stays on get_prompt
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-2">ID</th>
              <th className="text-left px-5 py-2">Status</th>
              <th className="text-left px-5 py-2">Lane</th>
              <th className="text-left px-5 py-2">Actor</th>
              <th className="text-left px-5 py-2">Summary</th>
              <th className="text-left px-5 py-2">Outcome</th>
              <th className="text-left px-5 py-2">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {versions.length === 0 && emptyRow(7, "No rule versions seeded yet.")}
            {versions.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50 align-top">
                <td className="px-5 py-3 font-medium tabular-nums">v{v.id}</td>
                <td className="px-5 py-3">
                  <span className={`badge ${statusBadgeClass(v.status)}`}>{v.status}</span>
                </td>
                <td className="px-5 py-3 text-xs text-gray-600">{v.lane ?? "—"}</td>
                <td className="px-5 py-3 text-xs text-gray-600">{v.actor}</td>
                <td className="px-5 py-3 text-gray-700 max-w-md">{v.changeSummary ?? "—"}</td>
                <td className="px-5 py-3 text-xs text-gray-600">{v.outcome ?? "—"}</td>
                <td className="px-5 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                  {v.createdAt?.slice(0, 10) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
