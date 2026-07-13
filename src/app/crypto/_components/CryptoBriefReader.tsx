import type { CryptoBriefDTO } from "@/lib/crypto/db";
import { actionBadgeClass, fmtShortDateUtc } from "@/lib/crypto/format";

export type BriefCall = {
  symbol: string;
  action: string;
  confidence?: number | null;
  reason?: string | null;
};

/** Coerce the brief's `calls` Json into a typed array. */
export function parseCalls(calls: unknown): BriefCall[] {
  if (!Array.isArray(calls)) return [];
  return calls
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c) => ({
      symbol: String(c.symbol ?? ""),
      action: String(c.action ?? ""),
      confidence: typeof c.confidence === "number" ? c.confidence : null,
      reason: c.reason != null ? String(c.reason) : null,
    }))
    .filter((c) => c.symbol);
}

/** Structured render of a daily brief (market summary + calls table + notes). */
export function CryptoBriefReader({ brief }: { brief: CryptoBriefDTO }) {
  const calls = parseCalls(brief.calls);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
          Market summary — {fmtShortDateUtc(brief.briefDate)}
        </div>
        <p className="text-sm text-gray-800 leading-relaxed m-0 whitespace-pre-wrap">
          {brief.marketSummary}
        </p>
      </div>

      {calls.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Symbol</th>
                <th className="text-left px-3 py-2">Call</th>
                <th className="text-right px-3 py-2">Conf.</th>
                <th className="text-left px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {calls.map((c, i) => (
                <tr key={`${c.symbol}-${i}`}>
                  <td className="px-3 py-2 font-medium">{c.symbol}</td>
                  <td className="px-3 py-2">
                    <span className={`badge ${actionBadgeClass(c.action)}`}>{c.action}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.confidence != null ? `${c.confidence}/5` : "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{c.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {brief.watchlistNotes ? (
        <div className="pt-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
            Watchlist notes
          </div>
          <p className="text-sm text-gray-700 leading-relaxed m-0 whitespace-pre-wrap">
            {brief.watchlistNotes}
          </p>
        </div>
      ) : null}
    </div>
  );
}
