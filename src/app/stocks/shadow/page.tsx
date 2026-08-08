import Link from "next/link";
import type { Branch, EvolutionEventKind } from "@/generated/prisma/client";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { ShadowFitnessChart } from "@/app/stocks/_components/ShadowFitnessChart";
import { listDecisionReviews } from "@/lib/agent/writes";
import { listEvolutionEvents } from "@/lib/evolution/log";
import { getKernel, listRuleVersions } from "@/lib/evolution/read";
import { getShadowFitness, listCounterfactuals } from "@/lib/fitness/read";
import { getBranch, SHADOW_INITIAL_NAV } from "@/lib/shadow/branches";
import {
  listShadowOrders,
  listShadowPositions,
  shadowContextBlock,
} from "@/lib/shadow/read";
import { getSyncStatus } from "@/lib/stocks/db";
import { fmtMoney, fmtPct, fmtTicker, pnlToneClass } from "@/lib/stocks/format";

export const revalidate = 300;

type PageProps = {
  searchParams: Promise<{ branch?: string | string[] }>;
};

function parseBranch(raw: string | string[] | undefined): Branch {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "CANDIDATE" ? "CANDIDATE" : "LIVE";
}

/** Fitness / credit values are NAV fractions (0.03 = 3%). */
function fmtSignedFrac(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

function kindBadgeClass(kind: EvolutionEventKind): string {
  switch (kind) {
    case "PROMOTE":
      return "bg-emerald-100 text-emerald-800";
    case "PROPOSE":
    case "GAPFIX":
      return "bg-sky-100 text-sky-800";
    case "SCORE":
      return "bg-indigo-100 text-indigo-800";
    case "EARLY_KILL":
    case "HARD_REVERT":
    case "KERNEL_ATTEMPT":
    case "ELIGIBILITY_REJECT":
    case "DRIFT_BLOCK":
      return "bg-rose-100 text-rose-800";
    case "INCONCLUSIVE":
    case "PATTERN_RETIRED":
    case "MIRROR":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "ACTIVE":
    case "FILLED":
    case "RESOLVED":
      return "bg-emerald-100 text-emerald-800";
    case "CANDIDATE":
    case "OPEN":
      return "bg-sky-100 text-sky-800";
    case "RETIRED":
    case "UNRESOLVED":
      return "bg-gray-100 text-gray-700";
    case "KILLED":
    case "REJECTED":
    case "EXPIRED":
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "PENDING":
    case "WAITING":
    case "REVIEWED_1W":
    case "REVIEWED_4W":
    case "REVIEWED_3M":
      return "bg-amber-100 text-amber-800";
    case "CLOSED":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function eventSummary(kind: EvolutionEventKind, detail: unknown): string {
  if (!detail || typeof detail !== "object") return "—";
  const d = detail as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = d[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return null;
  };
  switch (kind) {
    case "PROPOSE":
      return pick("changeSummary", "summary", "reason") ?? "Candidate proposed";
    case "GAPFIX":
      return pick("reason", "file", "sectionId") ?? "Gap fix applied";
    case "PROMOTE":
      return pick("changeSummary", "reason") ?? "Candidate promoted";
    case "EARLY_KILL":
    case "HARD_REVERT":
    case "INCONCLUSIVE":
      return pick("reason", "skipped", "verdict") ?? kind.replaceAll("_", " ").toLowerCase();
    case "ELIGIBILITY_REJECT":
    case "KERNEL_ATTEMPT":
    case "DRIFT_BLOCK":
      return pick("reason", "message", "code") ?? "Rejected";
    case "SCORE":
      return pick("outcome", "outcomeClaim", "reason") ?? "Scored";
    default:
      return pick("reason", "skipped", "changeSummary", "message") ?? "—";
  }
}

function emptyRow(cols: number, message: string) {
  return (
    <tr>
      <td colSpan={cols} className="px-5 py-6 text-sm text-gray-500">
        {message}
      </td>
    </tr>
  );
}

export default async function ShadowMonitorPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const branch = parseBranch(params.branch);

  const [
    liveBook,
    candidateBook,
    liveBranch,
    candidateBranch,
    fitness,
    positions,
    orders,
    counterfactuals,
    evolution,
    versions,
    kernel,
    decisions,
    status,
  ] = await Promise.all([
    shadowContextBlock("LIVE"),
    shadowContextBlock("CANDIDATE"),
    getBranch("LIVE"),
    getBranch("CANDIDATE"),
    getShadowFitness({ branch, limit: 60 }),
    listShadowPositions({ branch, includeClosed: true }),
    listShadowOrders({ branch, limit: 40 }),
    listCounterfactuals({ branch, limit: 40 }),
    listEvolutionEvents({ limit: 40 }),
    listRuleVersions({ limit: 100 }),
    Promise.resolve(getKernel()),
    listDecisionReviews({ branch, limit: 200 }),
    getSyncStatus(),
  ]);

  // Open first, then closed; ticker within each group.
  const sortedPositions = [...positions.positions].sort((a, b) => {
    const ac = a.closedAt ? 1 : 0;
    const bc = b.closedAt ? 1 : 0;
    if (ac !== bc) return ac - bc;
    return a.ticker.localeCompare(b.ticker);
  });
  const openPositions = sortedPositions.filter((p) => !p.closedAt);
  const closedPositions = sortedPositions.filter((p) => p.closedAt);
  const branchDecisions = decisions;
  const active = versions.ruleVersions.find((v) => v.status === "ACTIVE") ?? null;
  const candidates = versions.ruleVersions.filter((v) => v.status === "CANDIDATE");
  const latest = fitness.snapshots[0] ?? null;
  const selectedBook = branch === "LIVE" ? liveBook : candidateBook;
  const selectedBranchRow = branch === "LIVE" ? liveBranch : candidateBranch;
  const branchRulesetId = selectedBranchRow?.ruleVersionId ?? null;
  const branchRuleset =
    branchRulesetId != null
      ? (versions.ruleVersions.find((v) => v.id === branchRulesetId) ?? null)
      : null;

  const startNav = selectedBranchRow?.startNav ?? SHADOW_INITIAL_NAV;
  const navNow = selectedBook?.nav ?? latest?.nav ?? null;
  const totalReturn =
    navNow !== null && startNav > 0 ? (navNow - startNav) / startNav : null;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Shadow evolution</h1>
          <p className="text-sm text-gray-500 max-w-2xl">
            Read-only view of the paper books and the learning loop — fitness, fills,
            counterfactuals, rule versions, and the append-only evolution log. This never
            touches the real portfolio.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 self-start">
          {(["LIVE", "CANDIDATE"] as const).map((b) => (
            <Link
              key={b}
              href={b === "LIVE" ? "/stocks/shadow" : `/stocks/shadow?branch=${b}`}
              className={`px-3 py-1.5 text-sm font-medium rounded transition ${
                branch === b
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {b}
            </Link>
          ))}
        </div>
      </section>

      <SyncStatusBanner status={status} />

      {/* Dual-book strip */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(
          [
            {
              label: "LIVE book",
              book: liveBook,
              row: liveBranch,
              href: "/stocks/shadow",
              selected: branch === "LIVE",
            },
            {
              label: "CANDIDATE book",
              book: candidateBook,
              row: candidateBranch,
              href: "/stocks/shadow?branch=CANDIDATE",
              selected: branch === "CANDIDATE",
            },
          ] as const
        ).map(({ label, book, row, href, selected }) => (
            <Link
              key={label}
              href={href}
              className={`card p-5 block transition ${
                selected ? "ring-2 ring-gray-900" : "hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium">{label}</h2>
                {!book ? (
                  <span className="badge bg-amber-100 text-amber-800">not seeded</span>
                ) : (
                  <span className="badge bg-gray-100 text-gray-700">
                    {book.openPositions} open
                  </span>
                )}
              </div>
              {book ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">NAV</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {fmtMoney(book.nav)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Cash</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {fmtMoney(book.cash)}
                    </div>
                  </div>
                  <div className="col-span-2 text-xs text-gray-500">
                    Ruleset {row ? `v${row.ruleVersionId}` : "—"}
                    {" · "}
                    Last mark: {book.lastMarkSession ?? "—"}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  Branch appears after the first cron job that needs a ruleset.
                </p>
              )}
            </Link>
          ))}
      </section>

      {/* Headline metrics for selected branch */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Paper NAV",
            value: fmtMoney(navNow),
            hint: "Cash + marked positions",
          },
          {
            label: `Return vs ${fmtMoney(startNav)} start`,
            value: fmtSignedFrac(totalReturn),
            tone: totalReturn,
            hint: "Since this branch's last reset",
          },
          {
            label: "Window fitness",
            value: fmtSignedFrac(latest?.windowFitness),
            tone: latest?.windowFitness,
            hint: "Rolling scored fitness",
          },
          {
            label: "Max drawdown",
            value: latest?.maxDrawdown != null ? fmtPct(latest.maxDrawdown) : "—",
            tone: latest?.maxDrawdown != null ? -Math.abs(latest.maxDrawdown) : null,
            hint: "Rolling 30-session peak-to-trough",
          },
        ].map((m) => (
          <div key={m.label} className="card p-4">
            <div className="text-xs text-gray-500">{m.label}</div>
            <div
              className={`mt-1 text-xl font-semibold tabular-nums ${
                m.tone !== undefined ? pnlToneClass(m.tone) : ""
              }`}
            >
              {m.value}
            </div>
            <div className="mt-1 text-xs text-gray-400">{m.hint}</div>
          </div>
        ))}
      </section>

      {/* Fitness chart */}
      <section className="card p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-medium">Fitness trajectory · {branch}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Paper NAV (gray) and window fitness (green). All fitness values are fractions
              of NAV.
            </p>
          </div>
          <span className="text-xs text-gray-500 shrink-0">
            {fitness.snapshots.length} sessions
          </span>
        </div>
        <ShadowFitnessChart snapshots={fitness.snapshots} />
      </section>

      {/* Ruleset / evolution status */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="font-medium">Ruleset on {branch}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Each paper book points at a RuleVersion. LIVE tracks ACTIVE; CANDIDATE tracks
              the challenger (or the same ACTIVE until a proposal lands).
            </p>
          </div>
          {branchRuleset || branchRulesetId != null ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular-nums">
                  v{branchRuleset?.id ?? branchRulesetId}
                </span>
                {branchRuleset ? (
                  <span className={`badge ${statusBadgeClass(branchRuleset.status)}`}>
                    {branchRuleset.status}
                  </span>
                ) : null}
                {branchRuleset?.actor ? (
                  <span className="badge bg-gray-100 text-gray-700">
                    {branchRuleset.actor}
                  </span>
                ) : null}
                {branchRuleset?.lane ? (
                  <span className="badge bg-indigo-100 text-indigo-800">
                    {branchRuleset.lane}
                  </span>
                ) : null}
              </div>
              <p className="text-gray-700">
                {branchRuleset?.changeSummary ??
                  (branchRulesetId != null
                    ? `Branch pointer is v${branchRulesetId} (metadata not in latest list).`
                    : "No change summary.")}
              </p>
              <div className="text-xs text-gray-500">
                Activated {branchRuleset?.activatedAt?.slice(0, 10) ?? "—"}
                {branchRuleset?.parentId != null
                  ? ` · parent v${branchRuleset.parentId}`
                  : ""}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No ruleset pointer on this branch yet.</p>
          )}

          {active && branchRulesetId !== active.id ? (
            <div className="border-t border-gray-100 pt-4 text-sm text-gray-600">
              Global ACTIVE is <span className="font-medium tabular-nums">v{active.id}</span>
              {active.changeSummary ? ` — ${active.changeSummary}` : ""}.
            </div>
          ) : null}

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium mb-2">Candidates in flight</h3>
            {candidates.length === 0 ? (
              <p className="text-sm text-gray-500">None — propose via weekly evolution loop.</p>
            ) : (
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular-nums">v{c.id}</span>
                      <span className={`badge ${statusBadgeClass(c.status)}`}>
                        {c.status}
                      </span>
                      {c.lane ? (
                        <span className="badge bg-indigo-100 text-indigo-800">{c.lane}</span>
                      ) : null}
                    </div>
                    <p className="text-gray-600 mt-0.5">
                      {c.changeSummary ?? "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="card p-5 space-y-3">
          <div>
            <h2 className="font-medium">Kernel fences</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Pinned clauses — proposals that touch these are rejected and logged as{" "}
              <code className="text-[0.7rem]">KERNEL_ATTEMPT</code>.
            </p>
          </div>
          <ul className="space-y-2">
            {kernel.clauses.map((c) => (
              <li key={c.id} className="text-sm border border-gray-100 rounded-md px-3 py-2">
                <div className="font-medium text-gray-900">{c.id}</div>
                <div className="text-xs text-gray-400 font-mono truncate">{c.sha256}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Evolution timeline */}
      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-medium">Evolution log</h2>
            <p className="text-xs text-gray-500">Append-only audit trail · newest first</p>
          </div>
          <span className="text-xs text-gray-500">{evolution.events.length} events</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-2">When</th>
                <th className="text-left px-5 py-2">Kind</th>
                <th className="text-left px-5 py-2">Version</th>
                <th className="text-left px-5 py-2">Actor</th>
                <th className="text-left px-5 py-2">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {evolution.events.length === 0 &&
                emptyRow(5, "No evolution events yet. Proposals and cron verdicts land here.")}
              {evolution.events.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50 align-top">
                  <td className="px-5 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                    {e.createdAt.slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`badge ${kindBadgeClass(e.kind)}`}>{e.kind}</span>
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    {e.ruleVersionId != null ? `v${e.ruleVersionId}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">{e.actor}</td>
                  <td className="px-5 py-3 text-gray-700 max-w-md">
                    {eventSummary(e.kind, e.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Positions */}
      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-medium">Paper positions · {branch}</h2>
            <p className="text-xs text-gray-500">Simulated holdings — never the real book</p>
          </div>
          <span className="text-xs text-gray-500">
            {openPositions.length} open · {closedPositions.length} closed
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-2">Ticker</th>
                <th className="text-left px-5 py-2">Opened</th>
                <th className="text-right px-5 py-2">Shares</th>
                <th className="text-right px-5 py-2">Avg cost</th>
                <th className="text-right px-5 py-2">Mark</th>
                <th className="text-right px-5 py-2">Mkt value</th>
                <th className="text-right px-5 py-2">Realized</th>
                <th className="text-left px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sortedPositions.length === 0 &&
                emptyRow(8, "No paper positions yet. Fills enqueue from Decision Reviews.")}
              {sortedPositions.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium tracking-wide tabular-nums">
                    {fmtTicker(p.ticker)}
                    {p.markStale ? (
                      <span className="ml-2 badge bg-amber-100 text-amber-800">stale</span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500 tabular-nums">
                    {p.openedSession ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {p.shares.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{fmtMoney(p.avgCost)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{fmtMoney(p.lastMark)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {p.closedAt ? "—" : fmtMoney(p.marketValue)}
                  </td>
                  <td
                    className={`px-5 py-3 text-right tabular-nums ${pnlToneClass(p.realizedPnl)}`}
                  >
                    {fmtMoney(p.realizedPnl)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`badge ${p.closedAt ? "bg-gray-100 text-gray-700" : "bg-sky-100 text-sky-800"}`}
                    >
                      {p.closedAt ? "CLOSED" : "OPEN"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Orders */}
      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-medium">Paper orders · {branch}</h2>
            <p className="text-xs text-gray-500">
              Simulated fills from decision reviews. BUY size is % of NAV; SELL size is % of
              the open position.
            </p>
          </div>
          <span className="text-xs text-gray-500">{orders.orders.length} shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-2">Session</th>
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
              {orders.orders.length === 0 &&
                emptyRow(8, "No paper orders yet for this branch.")}
              {orders.orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50 align-top">
                  <td className="px-5 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                    {o.decisionSession ?? "—"}
                  </td>
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

      {/* Counterfactuals */}
      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="font-medium">Counterfactuals · {branch}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            What refused decisions (AVOID / WAIT / DO_NOT_AVERAGE_DOWN) would have been
            worth. Credit is signed: refusing a name that fell credits you; refusing one
            that rose debits you.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-2">Decision</th>
                <th className="text-left px-5 py-2">Ticker</th>
                <th className="text-left px-5 py-2">Type</th>
                <th className="text-right px-5 py-2">Horizon ret</th>
                <th className="text-right px-5 py-2">Credit</th>
                <th className="text-left px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {counterfactuals.counterfactuals.length === 0 &&
                emptyRow(6, "No counterfactuals seeded yet for this branch.")}
              {counterfactuals.counterfactuals.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                    {c.decisionSession ?? "—"}
                  </td>
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

      {/* Decision reviews for this branch */}
      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-medium">Decision reviews · {branch}</h2>
            <p className="text-xs text-gray-500">
              Branch-scoped. CANDIDATE stays empty until a second Cowork schedule writes with{" "}
              <code className="text-[0.7rem]">branch=&quot;CANDIDATE&quot;</code>.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-gray-500">
              {branchDecisions.length > 30
                ? `showing 30 of ${branchDecisions.length}`
                : `${branchDecisions.length} rows`}
            </span>
            <Link href="/stocks/decisions" className="text-sm hover:underline">
              All decisions
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-2">Date</th>
                <th className="text-left px-5 py-2">Ticker</th>
                <th className="text-left px-5 py-2">Type</th>
                <th className="text-left px-5 py-2">Title</th>
                <th className="text-left px-5 py-2">Status</th>
                <th className="text-left px-5 py-2">Rules ver</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {branchDecisions.length === 0 &&
                emptyRow(
                  6,
                  branch === "CANDIDATE"
                    ? "No CANDIDATE decision reviews yet."
                    : "No LIVE decision reviews yet.",
                )}
              {branchDecisions.slice(0, 30).map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                    {d.decisionDate?.slice(0, 10) ?? "—"}
                  </td>
                  <td className="px-5 py-3 font-medium tracking-wide tabular-nums">
                    {fmtTicker(d.ticker)}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">
                    {d.decisionType ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-700 max-w-sm truncate">
                    {d.title ?? "—"}
                  </td>
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

      {/* Recent fitness table */}
      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="font-medium">Fitness snapshots · {branch}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Daily increments are fractions of NAV. Fitness Δ = daily + avoided − turnover −
            CSPX. <em>avoidedCreditDelta</em> is signed.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-2">Session</th>
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
              {fitness.snapshots.length === 0 &&
                emptyRow(8, "No fitness snapshots yet for this branch.")}
              {fitness.snapshots.slice(0, 30).map((s, i) => (
                <tr key={`${s.session ?? "sess"}-${i}`} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-xs text-gray-500 tabular-nums">
                    {s.session ?? "—"}
                  </td>
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
                      <span className="ml-1 text-xs text-amber-700">
                        {s.staleMarks} stale
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Rule version history */}
      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="font-medium">Rule version history</h2>
          <p className="text-xs text-gray-500">Metadata only — prompt text stays on get_prompt</p>
        </div>
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
              {versions.ruleVersions.length === 0 &&
                emptyRow(7, "No rule versions seeded yet.")}
              {versions.ruleVersions.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50 align-top">
                  <td className="px-5 py-3 font-medium tabular-nums">v{v.id}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${statusBadgeClass(v.status)}`}>{v.status}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">{v.lane ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-gray-600">{v.actor}</td>
                  <td className="px-5 py-3 text-gray-700 max-w-md">
                    {v.changeSummary ?? "—"}
                  </td>
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
    </div>
  );
}
