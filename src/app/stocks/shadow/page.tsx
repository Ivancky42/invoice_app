import { Suspense } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { ShadowBooksChart } from "@/app/stocks/_components/ShadowBooksChart";
import { getShadowTestSummary, type ShadowBookLastTrade } from "@/lib/shadow/summary";
import { fmtDayMonth } from "@/lib/shadow/summaryMath";
import { getSyncStatus } from "@/lib/stocks/db";
import { fmtMoney, fmtPct, fmtTicker, pnlToneClass } from "@/lib/stocks/format";
import { ShadowDetails } from "./_components/ShadowDetails";

export const revalidate = 300;

function statusBadge(status: "RUNNING" | "PAUSED" | "IDLE") {
  if (status === "RUNNING") return { label: "Running", className: "bg-emerald-100 text-emerald-800" };
  if (status === "PAUSED") return { label: "Paused", className: "bg-amber-100 text-amber-800" };
  return { label: "Idle", className: "bg-gray-100 text-gray-700" };
}

function fmtSignedPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtPct(n)}`;
}

function lastTradeWords(trade: ShadowBookLastTrade | null): string {
  if (!trade) return "No trades yet";
  const verb = trade.side === "SELL" ? "Sold" : "Bought";
  const pct = `${(trade.sizePct * 100).toFixed(trade.sizePct * 100 >= 10 ? 0 : 1)}%`;
  return `${verb} ${fmtTicker(trade.ticker)} ${pct} on ${fmtDayMonth(trade.session)}`;
}

function tradeSentence(args: {
  bookLabel: string;
  side: string;
  ticker: string;
  sizePct: number | null;
  session: string | null;
}): string {
  const verb = args.side === "SELL" ? "sold" : "bought";
  const pct =
    args.sizePct != null && Number.isFinite(args.sizePct)
      ? ` ${(args.sizePct * 100).toFixed(args.sizePct * 100 >= 10 ? 0 : 1)}%`
      : "";
  const when = args.session ? ` on ${fmtDayMonth(args.session)}` : "";
  return `${args.bookLabel} ${verb} ${fmtTicker(args.ticker)}${pct}${when}`;
}

function gateProgress(done: number | boolean, needed: number | boolean, id: string): string {
  if (typeof done === "boolean" || typeof needed === "boolean") {
    return done ? "On" : "Off";
  }
  if (id === "confidence") {
    return `${Math.round(done)}% / ${Math.round(needed)}%`;
  }
  if (id === "drawdown") {
    return `${fmtPct(done)} / ${fmtPct(needed)}`;
  }
  return `${done} / ${needed}`;
}

export default async function ShadowMonitorPage() {
  const [summary, status] = await Promise.all([getShadowTestSummary(), getSyncStatus()]);
  const badge = statusBadge(summary.status);
  const live = summary.books.LIVE;
  const cand = summary.books.CANDIDATE;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Shadow test</h1>
      </section>

      <SyncStatusBanner status={status} />

      <section className="card p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-lg sm:text-xl text-gray-900 leading-relaxed max-w-3xl">
            {summary.verdictSentence}
          </p>
          <span className={`badge ${badge.className} shrink-0`}>{badge.label}</span>
        </div>
        <p className="text-sm text-gray-500">
          How this works: Two paper portfolios trade the same watchlist. One follows the
          current rules, one follows the new rules. If the new rules win with high
          confidence, they are promoted. The test score counts portfolio return plus credit
          for losses a book avoided by not buying, so it can differ from the dollar values
          below.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(
          [
            { branch: "LIVE", book: live },
            { branch: "CANDIDATE", book: cand },
          ] as const
        ).map(({ branch, book }) => (
          <div key={branch} className="card p-5">
            <h2 className="font-medium mb-3">{book.label}</h2>
            <div className="text-2xl font-semibold tabular-nums">{fmtMoney(book.nav)}</div>
            <div
              className={`mt-1 text-sm tabular-nums ${pnlToneClass(book.changeSincePct)}`}
            >
              {fmtSignedPct(book.changeSincePct)} since the test started
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-gray-500">Invested</dt>
                <dd className="tabular-nums">{fmtPct(book.investedPct)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Positions</dt>
                <dd className="tabular-nums">{book.positionsCount}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-gray-600">{lastTradeWords(book.lastTrade)}</p>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="font-medium mb-1">Both books since the test started</h2>
        <p className="text-xs text-gray-500 mb-4">
          Each book starts at 100 on the first day of this test.
        </p>
        <ShadowBooksChart
          current={{
            label: live.label,
            color: "#111827",
            points: summary.series.LIVE,
          }}
          challenger={{
            label: cand.label,
            color: "#0369a1",
            points: summary.series.CANDIDATE,
          }}
        />
      </section>

      <section className="card p-5">
        <h2 className="font-medium mb-4">Promotion checklist</h2>
        <ul className="space-y-3">
          {summary.gates.map((g) => (
            <li key={g.id} className="flex items-start gap-3">
              {g.ok ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
              ) : (
                <Circle className="w-5 h-5 text-gray-300 shrink-0 mt-0.5" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm text-gray-900">{g.label}</span>
                  <span className="text-sm tabular-nums text-gray-600">
                    {gateProgress(g.done, g.needed, g.id)}
                  </span>
                </div>
                {g.note ? <p className="text-xs text-gray-400 mt-0.5">{g.note}</p> : null}
              </div>
            </li>
          ))}
        </ul>
        {summary.earliestDecisionDate ? (
          <p className="mt-4 text-sm text-gray-600">
            Earliest decision around {fmtDayMonth(summary.earliestDecisionDate)}
          </p>
        ) : null}
      </section>

      <section className="card p-5">
        <h2 className="font-medium mb-3">What the books did</h2>
        {summary.recentTrades.length === 0 ? (
          <p className="text-sm text-gray-500">No paper trades yet.</p>
        ) : (
          <ul className="space-y-2">
            {summary.recentTrades.map((t, i) => (
              <li
                key={`${t.session}-${t.ticker}-${t.side}-${i}`}
                className="text-sm text-gray-800"
              >
                {tradeSentence(t)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-3">Positions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(
            [
              { label: live.label, rows: summary.positions.LIVE },
              { label: cand.label, rows: summary.positions.CANDIDATE },
            ] as const
          ).map((col, i) => (
            <div key={i === 0 ? "LIVE" : "CANDIDATE"} className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-200">
                <h3 className="text-sm font-medium">{col.label}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-5 py-2">Ticker</th>
                      <th className="text-right px-5 py-2">Weight</th>
                      <th className="text-right px-5 py-2">Since entry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {col.rows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-4 text-sm text-gray-500">
                          No open positions.
                        </td>
                      </tr>
                    ) : (
                      col.rows.map((p) => (
                        <tr key={p.ticker}>
                          <td className="px-5 py-2 font-medium tracking-wide tabular-nums">
                            {fmtTicker(p.ticker)}
                          </td>
                          <td className="px-5 py-2 text-right tabular-nums">
                            {fmtPct(p.weightPct)}
                          </td>
                          <td
                            className={`px-5 py-2 text-right tabular-nums ${pnlToneClass(p.pnlSinceEntryPct)}`}
                          >
                            {fmtSignedPct(p.pnlSinceEntryPct)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-medium mb-3">History</h2>
        {summary.history.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing has happened yet.</p>
        ) : (
          <ol className="space-y-3">
            {summary.history.map((h, i) => (
              <li key={`${h.at}-${h.kind}-${i}`} className="text-sm">
                <div className="text-xs text-gray-400 tabular-nums">
                  {fmtDayMonth(h.at)}
                </div>
                <div className="text-gray-800">{h.sentence}</div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <details className="card">
        <summary className="px-5 py-3 cursor-pointer font-medium">
          Details for the curious
        </summary>
        <Suspense
          fallback={
            <p className="px-5 py-6 text-sm text-gray-500">Loading the detailed tables…</p>
          }
        >
          <ShadowDetails
            liveLabel={live.label}
            candidateLabel={cand.label}
            rejectedTrades={summary.rejectedTrades}
          />
        </Suspense>
      </details>
    </div>
  );
}
