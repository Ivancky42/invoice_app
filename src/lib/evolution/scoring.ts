/**
 * Retrospective scoring of finished rule versions: did this change actually help?
 *
 * The verdict is computed SERVER-SIDE from the fitness ledger. The agent may attach an
 * `outcomeClaim`; it is stored under `outcomeDetail.agentClaim` and logged, and it is
 * NEVER accepted as the outcome — a system that lets the proposer grade its own homework
 * has no selection pressure at all.
 *
 * Scoring writes `RuleVersion.outcome` / `outcomeDetail`. That is an UPDATE, and it is
 * allowed: only `EvolutionEvent` is append-only.
 */
import type { Prisma, RuleOutcome } from "@/generated/prisma/client";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import { appendEvolutionEvent } from "@/lib/evolution/log";
import { prisma } from "@/lib/prisma";
import { decToNum } from "@/lib/stocks/format";

/**
 * Per-session fitness edge (a FRACTION of NAV) beyond which a version is called HELPED or
 * HURT. 5 bps/session ≈ 1.25%/month of excess fitness — big enough that snapshot noise
 * does not produce a verdict, small enough that a genuinely useful rail is not filed under
 * NEUTRAL forever. The number is a judgement call, not a derivation; it is a named
 * constant precisely so it can be argued with and changed in one place.
 */
export const SCORE_HELPED_THRESHOLD = 0.0005;
export const SCORE_HURT_THRESHOLD = -0.0005;

/** Paired sessions below which the series says nothing and the verdict stays NEUTRAL. */
export const SCORE_MIN_SESSIONS = 10;

/** Sessions that must have elapsed since retirement before auto-scoring picks a version up. */
export const SCORE_MIN_AGE_SESSIONS = 30;

/** HURT versions sharing a reasoningPattern at which the pattern itself is retired. */
export const PATTERN_RETIREMENT_COUNT = 2;

export type MetricCheck = "MET" | "MISSED" | "UNKNOWN";

export type ClassifyOutcomeInput = {
  deltaPerSession: number;
  sessions: number;
  metricCheck: MetricCheck;
};

/**
 * PURE verdict rule. A thin series is NEUTRAL regardless of its mean; a version whose own
 * stated success metric was demonstrably missed cannot be called HELPED even if the raw
 * delta clears the bar — the proposer's own falsification condition outranks the average.
 */
export function classifyOutcome({
  deltaPerSession,
  sessions,
  metricCheck,
}: ClassifyOutcomeInput): RuleOutcome {
  if (!Number.isFinite(deltaPerSession) || sessions < SCORE_MIN_SESSIONS) return "NEUTRAL";
  if (deltaPerSession <= SCORE_HURT_THRESHOLD) return "HURT";
  if (deltaPerSession >= SCORE_HELPED_THRESHOLD) {
    return metricCheck === "MISSED" ? "NEUTRAL" : "HELPED";
  }
  return "NEUTRAL";
}

export type ParsedMetric = { term: string; target: number };

/**
 * Pull the first number and the metric term out of a recorded successMetric
 * ("candidate fitness beats live by 0.002/session"). Null when nothing is parseable —
 * in which case the metric check is UNKNOWN and only the thresholds decide.
 */
export function parseSuccessMetric(successMetric: string | null): ParsedMetric | null {
  if (!successMetric) return null;
  const text = successMetric.toLowerCase();
  const num = /-?\d+(?:\.\d+)?/.exec(text);
  if (!num) return null;
  const term = ["fitness", "return", "drawdown", "credit", "hit rate", "winrate", "win rate"].find(
    (t) => text.includes(t),
  );
  if (!term) return null;
  return { term, target: Number(num[0]) };
}

/**
 * Compare the observed per-session edge against a parsed metric claim. Only fitness/return
 * style claims are checkable here; anything else stays UNKNOWN rather than being guessed at.
 */
export function checkMetric(
  parsed: ParsedMetric | null,
  deltaPerSession: number,
  sessions: number,
): MetricCheck {
  if (!parsed) return "UNKNOWN";
  if (parsed.term !== "fitness" && parsed.term !== "return") return "UNKNOWN";
  // A target ≥ 1 is being stated in percent-ish units we cannot safely reinterpret.
  if (Math.abs(parsed.target) >= 1) return "UNKNOWN";
  const cumulative = deltaPerSession * sessions;
  return cumulative >= parsed.target ? "MET" : "MISSED";
}

/** reasoningPatterns already retired: ≥2 versions with outcome HURT share them. */
export async function retiredReasoningPatterns(): Promise<string[]> {
  const grouped = await prisma.ruleVersion.groupBy({
    by: ["reasoningPattern"],
    where: { outcome: "HURT", reasoningPattern: { not: null } },
    _count: { _all: true },
  });
  return grouped
    .filter((g) => g._count._all >= PATTERN_RETIREMENT_COUNT && g.reasoningPattern)
    .map((g) => g.reasoningPattern as string);
}

type SnapshotRow = { session: Date; fitnessIncrement: number | null };

async function loadPairedSeries(
  ownBranch: "LIVE" | "CANDIDATE",
  from: Date,
  to: Date,
): Promise<{ deltaPerSession: number; sessions: number }> {
  const branches = await prisma.shadowBranch.findMany({ select: { id: true, branch: true } });
  const ownId = branches.find((b) => b.branch === ownBranch)?.id;
  const otherId = branches.find((b) => b.branch !== ownBranch)?.id;
  if (!ownId || !otherId) return { deltaPerSession: 0, sessions: 0 };

  const rows = await prisma.fitnessSnapshot.findMany({
    where: {
      branchId: { in: [ownId, otherId] },
      session: { gt: from, lte: to },
      quality: "OK",
    },
    select: { branchId: true, session: true, fitnessIncrement: true },
    orderBy: { session: "asc" },
  });

  const own = new Map<number, SnapshotRow>();
  const other = new Map<number, SnapshotRow>();
  for (const r of rows) {
    const target = r.branchId === ownId ? own : other;
    target.set(r.session.getTime(), {
      session: r.session,
      fitnessIncrement: decToNum(r.fitnessIncrement),
    });
  }

  const deltas: number[] = [];
  for (const [key, mine] of own) {
    const theirs = other.get(key);
    if (!theirs) continue;
    if (mine.fitnessIncrement === null || theirs.fitnessIncrement === null) continue;
    deltas.push(mine.fitnessIncrement - theirs.fitnessIncrement);
  }
  if (deltas.length === 0) return { deltaPerSession: 0, sessions: 0 };
  return {
    deltaPerSession: deltas.reduce((s, v) => s + v, 0) / deltas.length,
    sessions: deltas.length,
  };
}

export type ScoreRuleVersionInput = {
  versionId: number;
  /** The agent's own claim. Recorded and logged; never used as the outcome. */
  outcomeClaim?: string | null;
};

export type ScoreRuleVersionResult =
  | {
      ok: true;
      preview: false;
      versionId: number;
      outcome: RuleOutcome;
      deltaPerSession: number;
      sessions: number;
      patternRetired: boolean;
    }
  | {
      ok: true;
      /** Nothing was persisted: the series is too thin to say anything. */
      preview: true;
      versionId: number;
      outcome: null;
      reason: "insufficient_sessions";
      deltaPerSession: number;
      sessions: number;
      required: number;
    }
  | { ok: false; status: number; reason: string; details?: Record<string, unknown> };

/**
 * Score one finished version. Idempotent: re-running rewrites the same verdict.
 *
 * Below {@link SCORE_MIN_SESSIONS} paired sessions it returns a PREVIEW and writes NO
 * outcome — see the guard below for why an early NEUTRAL would be permanent.
 */
export async function scoreRuleVersion(
  input: ScoreRuleVersionInput,
): Promise<ScoreRuleVersionResult> {
  const version = await prisma.ruleVersion.findUnique({
    where: { id: input.versionId },
    select: {
      id: true,
      status: true,
      lane: true,
      activatedAt: true,
      retiredAt: true,
      evidenceCutoff: true,
      createdAt: true,
      successMetric: true,
      reasoningPattern: true,
      changedPaths: true,
    },
  });
  if (!version) {
    return { ok: false, status: 404, reason: "rule_version_not_found" };
  }
  if (version.status !== "RETIRED" && version.status !== "KILLED") {
    return {
      ok: false,
      status: 409,
      reason: "version_still_in_service",
      details: { status: version.status },
    };
  }

  // A version that was activated ran the LIVE book; one that never was ran the challenger.
  const ownBranch = version.activatedAt ? "LIVE" : "CANDIDATE";
  const from = version.activatedAt ?? version.evidenceCutoff ?? version.createdAt;
  const to = version.retiredAt ?? new Date();

  const { deltaPerSession, sessions } = await loadPairedSeries(ownBranch, from, to);

  // PREVIEW ONLY below the minimum series length. Persisting NEUTRAL here would be a
  // one-way door: the monthly job only picks up versions with `outcome: null`, so an early
  // call — which the agent can make the moment a version retires — would freeze a failing
  // version at NEUTRAL forever and starve pattern retirement of its HURT rows. An outcome is
  // written ONLY when the evidence is adequate. The SCORE event is still appended, flagged
  // `preview`, because "the agent asked and was told to wait" is itself auditable.
  if (sessions < SCORE_MIN_SESSIONS) {
    await appendEvolutionEvent({
      kind: "SCORE",
      ruleVersionId: version.id,
      actor: "AGENT",
      detail: {
        preview: true,
        outcome: null,
        reason: "insufficient_sessions",
        branch: ownBranch,
        from: from.toISOString(),
        to: to.toISOString(),
        deltaPerSession,
        sessions,
        required: SCORE_MIN_SESSIONS,
        agentClaim: input.outcomeClaim ?? null,
        scoredAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    });
    return {
      ok: true,
      preview: true,
      versionId: version.id,
      outcome: null,
      reason: "insufficient_sessions",
      deltaPerSession,
      sessions,
      required: SCORE_MIN_SESSIONS,
    };
  }

  const parsedMetric = parseSuccessMetric(version.successMetric);
  const metricCheck = checkMetric(parsedMetric, deltaPerSession, sessions);
  const outcome = classifyOutcome({ deltaPerSession, sessions, metricCheck });

  const outcomeDetail = {
    branch: ownBranch,
    from: from.toISOString(),
    to: to.toISOString(),
    deltaPerSession,
    sessions,
    thresholds: { helped: SCORE_HELPED_THRESHOLD, hurt: SCORE_HURT_THRESHOLD },
    minSessions: SCORE_MIN_SESSIONS,
    metricCheck,
    successMetric: version.successMetric,
    parsedMetric,
    // Recorded, never authoritative.
    agentClaim: input.outcomeClaim ?? null,
    scoredAt: new Date().toISOString(),
  };

  await prisma.ruleVersion.update({
    where: { id: version.id },
    data: { outcome, outcomeDetail: outcomeDetail as unknown as Prisma.InputJsonValue },
  });

  await appendEvolutionEvent({
    kind: "SCORE",
    ruleVersionId: version.id,
    actor: "CRON",
    detail: { outcome, ...outcomeDetail } as Prisma.InputJsonValue,
  });

  // Pattern retirement uses exactly the query the eligibility gate reads, so a pattern that
  // is retired here is the same pattern that will be refused at propose time.
  let patternRetired = false;
  if (outcome === "HURT" && version.reasoningPattern) {
    const patterns = await retiredReasoningPatterns();
    if (patterns.includes(version.reasoningPattern)) {
      const already = await prisma.ruleVersion.count({
        where: { outcome: "HURT", reasoningPattern: version.reasoningPattern },
      });
      await appendEvolutionEvent({
        kind: "PATTERN_RETIRED",
        ruleVersionId: version.id,
        actor: "CRON",
        detail: {
          reasoningPattern: version.reasoningPattern,
          hurtVersions: already,
          threshold: PATTERN_RETIREMENT_COUNT,
        } as Prisma.InputJsonValue,
      });
      patternRetired = true;
    }
  }

  return {
    ok: true,
    preview: false,
    versionId: version.id,
    outcome,
    deltaPerSession,
    sessions,
    patternRetired,
  };
}

/**
 * `rule_scoring` (monthly, 1st): score every finished version whose data has settled.
 * "Settled" = at least SCORE_MIN_AGE_SESSIONS snapshot sessions have closed since it was
 * retired, so a late-resolving counterfactual cannot flip the verdict after the fact.
 */
export async function runRuleScoring(_ctx: JobContext): Promise<JobResult> {
  const candidates = await prisma.ruleVersion.findMany({
    where: { status: { in: ["RETIRED", "KILLED"] }, outcome: null, retiredAt: { not: null } },
    select: { id: true, retiredAt: true },
    orderBy: { id: "asc" },
  });

  const scored: Array<{ id: number; outcome: RuleOutcome }> = [];
  let skippedTooRecent = 0;
  let skippedThinSeries = 0;

  for (const row of candidates) {
    const age = await prisma.fitnessSnapshot.count({
      where: { session: { gt: row.retiredAt! }, quality: "OK" },
    });
    // Two branches produce two rows per session.
    if (age / 2 < SCORE_MIN_AGE_SESSIONS) {
      skippedTooRecent += 1;
      continue;
    }
    const result = await scoreRuleVersion({ versionId: row.id });
    if (!result.ok) continue;
    // A preview wrote nothing; the version keeps `outcome: null` and is reconsidered next
    // month, by which time the paired series may have filled in.
    if (result.preview) {
      skippedThinSeries += 1;
      continue;
    }
    scored.push({ id: result.versionId, outcome: result.outcome });
  }

  return {
    done: true,
    detail: {
      considered: candidates.length,
      scored: scored.length,
      skippedTooRecent,
      skippedThinSeries,
      outcomes: scored,
    } as Prisma.InputJsonValue,
  };
}
