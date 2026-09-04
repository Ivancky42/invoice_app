/**
 * Pure helpers for the shadow-test summary: confidence mapping, NAV rebase,
 * trading-day projection, gate checklist, verdict sentence, event translation.
 * No prisma — every function is a total function of its arguments.
 */
import type { EvolutionEventKind } from "@/generated/prisma/client";
import { DRAWDOWN_GATE_FLOOR } from "@/lib/fitness/math";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** First sentence of a change summary, capped so a card never grows a paragraph. */
export function firstSentence(text: string | null | undefined, max = 140): string {
  if (!text) return "";
  const trimmed = text.trim();
  const stop = trimmed.search(/[.!?]/);
  const sentence = (stop >= 0 ? trimmed.slice(0, stop + 1) : trimmed).trim();
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Abramowitz-Stegun 7.1.26 erf approximation.
 * Accurate enough that Φ(1.96) prints as 97.5 and Φ(2.0) as 97.7.
 */
export function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF Φ(z) as a 0–100 percentage. */
export function normalCdfPct(z: number): number {
  return 50 * (1 + erfApprox(z / Math.SQRT2));
}

export type NavPoint = { session: string; nav: number };
export type RebasedPoint = { session: string; value: number };

/** Rebase a NAV series so the first usable point is 100. Later points are nav / first × 100. */
export function rebaseNavSeries(points: NavPoint[]): RebasedPoint[] {
  const usable = points.filter((p) => Number.isFinite(p.nav) && p.nav > 0);
  const first = usable[0];
  if (!first) return [];
  return usable.map((p) => ({
    session: p.session,
    value: (p.nav / first.nav) * 100,
  }));
}

/** Calendar YYYY-MM-DD, UTC. */
export function isoDay(d: Date | string): string {
  if (typeof d === "string") {
    const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
    return m?.[1] ?? d.slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

/** "4 Sep" — day then month, no year. */
export function fmtDayMonth(iso: string): string {
  const day = isoDay(iso);
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * Add `n` US trading days (Mon–Fri, holidays ignored) after `fromIso`.
 * n ≤ 0 returns `fromIso` unchanged.
 */
export function addUsTradingDays(fromIso: string, n: number): string {
  const day = isoDay(fromIso);
  const [y, mo, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (mo ?? 1) - 1, d ?? 1));
  let added = 0;
  while (added < n) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Project the earliest strong-tier decision date from the latest session.
 * Remaining ≤ 0 → that session (already enough days). No session → null.
 */
export function projectEarliestDecisionDate(
  latestSession: string | null,
  sessionsStillNeeded: number,
): string | null {
  if (!latestSession) return null;
  if (sessionsStillNeeded <= 0) return isoDay(latestSession);
  return addUsTradingDays(latestSession, sessionsStillNeeded);
}

export type ShadowTestStatus = "RUNNING" | "PAUSED" | "IDLE";

export type VerdictSentenceInput = {
  status: ShadowTestStatus;
  incumbentVersionId: number;
  challengerVersionId: number | null;
  testStart: string | null;
  sessionsDone: number;
  sessionsNeeded: number;
  deltaPct: number;
  z: number | null;
  confidencePct: number | null;
  confidenceNeededStrongPct: number;
  earliestDecisionDate: string | null;
};

function fmtEdgePct(fraction: number): string {
  return `${(Math.abs(fraction) * 100).toFixed(1)}%`;
}

function fmtConf(pct: number): string {
  return `${Math.round(pct)}%`;
}

/** Plain-English status line for the page headline. */
export function buildVerdictSentence(input: VerdictSentenceInput): string {
  const current = `v${input.incumbentVersionId}`;
  if (input.status === "IDLE" || input.challengerVersionId == null) {
    return `No new rules are being tested right now. Current rules: ${current}.`;
  }

  const neu = `v${input.challengerVersionId}`;
  const since = input.testStart ? ` since ${fmtDayMonth(input.testStart)}` : "";
  const days = `${input.sessionsDone} of ${input.sessionsNeeded} trading days done`;

  let compare: string;
  if (input.z === null || input.confidencePct === null) {
    compare = "Not enough data yet to compare.";
  } else if (input.deltaPct < 0) {
    compare = `${neu} is behind by ${fmtEdgePct(input.deltaPct)} on the test score — confidence ${fmtConf(input.confidencePct)}, need ${fmtConf(input.confidenceNeededStrongPct)}.`;
  } else {
    compare = `${neu} is ahead by ${fmtEdgePct(input.deltaPct)} on the test score — confidence ${fmtConf(input.confidencePct)}, need ${fmtConf(input.confidenceNeededStrongPct)}.`;
  }

  const earliest = input.earliestDecisionDate
    ? ` Earliest decision around ${fmtDayMonth(input.earliestDecisionDate)}.`
    : "";

  let sentence = `Testing ${neu} against ${current}${since}. ${days}. ${compare}${earliest}`;
  if (input.status === "PAUSED") {
    sentence +=
      " Auto-promote is switched off, so nothing will change until it is turned on.";
  }
  return sentence;
}

export type ShadowGate = {
  id: string;
  label: string;
  done: number | boolean;
  needed: number | boolean;
  ok: boolean;
  note?: string;
};

export type PromotionGateInput = {
  sessionsDone: number;
  sessionsNeeded: number;
  patientSessionsNeeded: number;
  confidencePct: number | null;
  confidenceNeededStrongPct: number;
  confidenceNeededPatientPct: number;
  candidateDecisions: number;
  liveDecisions: number;
  minDecisions: number;
  candidateMaxDrawdown: number;
  liveMaxDrawdown: number;
  resolvedCredits: number;
  minResolvedCredits: number;
  turnoverSessions: number;
  minTurnoverSessions: number;
  promoteSwitchOn: boolean;
};

/**
 * Promotion checklist rows. `ok` on each row is the same predicate the cron
 * uses for that gate (sessions vs strong minimum, Φ(z) vs Φ(strong.z), both
 * books vs minDecisions, DD ≤ max(live×1.25, 5%), credits, turnover, switch).
 */
export function buildPromotionGates(input: PromotionGateInput): ShadowGate[] {
  const ddLimit = Math.max(input.liveMaxDrawdown * 1.25, DRAWDOWN_GATE_FLOOR);
  const daysOk = input.sessionsDone >= input.sessionsNeeded;
  const confOk =
    input.confidencePct !== null && input.confidencePct >= input.confidenceNeededStrongPct;
  const decisionsOk =
    input.candidateDecisions >= input.minDecisions &&
    input.liveDecisions >= input.minDecisions;
  const ddOk = input.candidateMaxDrawdown <= ddLimit;
  const creditsOk = input.resolvedCredits >= input.minResolvedCredits;
  const turnoverOk = input.turnoverSessions >= input.minTurnoverSessions;

  const patientConf = Math.round(input.confidenceNeededPatientPct);
  return [
    {
      id: "sessions",
      label: "Enough trading days",
      done: input.sessionsDone,
      needed: input.sessionsNeeded,
      ok: daysOk,
      note: `or ${input.patientSessionsNeeded} days at ${patientConf}%`,
    },
    {
      id: "confidence",
      label: "Confidence the new rules are better",
      done: input.confidencePct ?? 0,
      needed: input.confidenceNeededStrongPct,
      ok: confOk,
    },
    {
      id: "decisions",
      label: "Both books made decisions",
      done: Math.min(input.candidateDecisions, input.liveDecisions),
      needed: input.minDecisions,
      ok: decisionsOk,
      note: `new ${input.candidateDecisions}, current ${input.liveDecisions}`,
    },
    {
      id: "drawdown",
      label: "Drawdown within limit",
      done: input.candidateMaxDrawdown,
      needed: ddLimit,
      ok: ddOk,
    },
    {
      id: "credits",
      label: "Avoided-loss credits resolved",
      done: input.resolvedCredits,
      needed: input.minResolvedCredits,
      ok: creditsOk,
    },
    {
      id: "turnover",
      label: "Trading costs seen",
      done: input.turnoverSessions,
      needed: input.minTurnoverSessions,
      ok: turnoverOk,
    },
    {
      id: "switch",
      label: "Auto-promote switch",
      done: input.promoteSwitchOn,
      needed: true,
      ok: input.promoteSwitchOn,
    },
  ];
}

function pickDetailString(detail: unknown, ...keys: string[]): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  for (const k of keys) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) return firstSentence(v.trim());
  }
  return null;
}

function detailField(detail: unknown, key: string): unknown {
  if (!detail || typeof detail !== "object") return undefined;
  return (detail as Record<string, unknown>)[key];
}

/**
 * Bookkeeping events Ivan does not need on the History card. MIRROR is an archive
 * copy; SCORE is a monthly bookkeeping stamp with no decision attached.
 */
const HIDDEN_HISTORY_KINDS: ReadonlySet<EvolutionEventKind> = new Set<EvolutionEventKind>([
  "MIRROR",
  "SCORE",
]);

export function isHistoryVisible(kind: EvolutionEventKind): boolean {
  return !HIDDEN_HISTORY_KINDS.has(kind);
}

/** One plain sentence per evolution-log kind. Keep the raw kind on the caller. */
export function translateEvolutionEvent(
  kind: EvolutionEventKind,
  ruleVersionId: number | null,
  detail: unknown,
): string {
  const v = ruleVersionId != null ? `v${ruleVersionId}` : "the rules";
  const summary = pickDetailString(detail, "changeSummary", "summary", "reason");
  switch (kind) {
    case "PROPOSE":
      return summary ? `New rules ${v} proposed: ${summary}` : `New rules ${v} proposed`;
    case "PROMOTE":
      return `${v} became the current rules`;
    case "EARLY_KILL": {
      // A rebase kill is bookkeeping: the same experiment continues as a new id.
      const reason = detailField(detail, "reason");
      if (reason === "rebased") {
        const next = detailField(detail, "newCandidateId");
        return typeof next === "number"
          ? `${v} continued as v${next} after the current rules were updated`
          : `${v} continued under a new id after the current rules were updated`;
      }
      if (reason === "rebase_conflict") {
        return `${v} was withdrawn: the current rules changed in the same place`;
      }
      return `${v} was stopped early: it was doing worse`;
    }
    case "HARD_REVERT":
      return `${v} was reverted: lost more than 25% from its peak`;
    case "INCONCLUSIVE":
      return `${v} test ended with no clear winner`;
    case "SCORE":
      return `${v} was scored`;
    case "GAPFIX":
      return detailField(detail, "human") === true
        ? `Ivan published an edit to the rules as ${v}`
        : `A small fix was applied to ${v}`;
    case "ELIGIBILITY_REJECT":
      return "A proposed change was rejected: it did not qualify";
    case "DRIFT_BLOCK":
      return "A proposed change was blocked: it drifted too far from the current rules";
    case "KERNEL_ATTEMPT":
      return "A proposed change was rejected: it would have edited a locked rule";
    case "PATTERN_RETIRED":
      return "A pattern was retired after it kept hurting results";
    case "MIRROR":
      return `${v} was copied to the archive`;
    default:
      return `${String(kind).replaceAll("_", " ").toLowerCase()}`;
  }
}
