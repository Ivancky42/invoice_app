/**
 * `evolution_evaluate` (daily, after `fitness_snapshot`): the only code path that can
 * promote a ruleset, and the only one that can kill a candidate on evidence.
 *
 * The comparison is PAIRED and DIFFERENCED per session: for every session where both
 * branches produced an OK snapshot, delta = candidate − live increment, where the increment
 * is the fitness increment minus its benchmark term (the same CSPX move on both sides).
 * Pairing removes the market from both sides, so a bull tape cannot promote anything; the
 * sequential z-test on those per-session increments is what decides.
 *
 * Promotion is CRON-ONLY. There is no agent tool for it (see the registration site in
 * src/lib/agent/mcp-tools.ts) — the proposer must never be able to crown its own proposal.
 */
import type { Prisma, RuleLane, RuleStatus } from "@/generated/prisma/client";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import { appendEvolutionEvent, countEvolutionEvents } from "@/lib/evolution/log";
import { COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS } from "@/lib/fitness/counterfactuals";
import {
  actionsDiffer,
  evaluateCandidate,
  KERNEL_DRAWDOWN_FLOOR,
  pairingIncrement,
  sequentialZ,
  type CandidateVerdict,
} from "@/lib/fitness/math";
import { prisma } from "@/lib/prisma";
import { challengerLegitimacy } from "@/lib/rules/challenger";
import { mirrorRuleVersion } from "@/lib/rules/gitMirror";
import { clearRuleSetCache } from "@/lib/rules/resolve";
import { cloneBranchBook, ensureShadowBranches, resetBranch } from "@/lib/shadow/branches";
import {
  CONFIG_KEYS,
  getConfig,
  getEvolutionThresholds,
  type EvolutionThresholds,
} from "@/lib/stocks/config";
import { decToNum } from "@/lib/stocks/format";

/** Config / env key: set to `"0"` / `false` to freeze promotion until a clean re-replay. */
export const EVOLUTION_PROMOTE_KEY = "EVOLUTION_PROMOTE";

/**
 * True when promotion is intentionally frozen (re-replay in progress, or ops kill switch).
 * Env wins over Config: `EVOLUTION_PROMOTE=0` always pauses; Config `false`/`0` also pauses.
 */
export async function isEvolutionPromotePaused(): Promise<boolean> {
  const env = process.env.EVOLUTION_PROMOTE?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off") return true;
  if (env === "1" || env === "true" || env === "on") return false;

  const raw = await getConfig(EVOLUTION_PROMOTE_KEY);
  if (raw === false || raw === 0 || raw === "0" || raw === "false" || raw === "off") {
    return true;
  }
  return false;
}

/**
 * The candidate book's RESOLVED interim-horizon rows with non-zero signed credit, for
 * refusals made during this test (decisionSession on/after the cutoff day — createdAt
 * would also count pre-clone refusals copied in at the clone). Counting every branch and
 * all time let years-old LIVE refusals satisfy the gate for a challenger that had
 * resolved none.
 */
export async function countResolvedNonZeroCredits(
  branchId: string,
  since: Date,
): Promise<number> {
  return prisma.counterfactual.count({
    where: {
      branchId,
      status: "RESOLVED",
      horizonSessions: COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS,
      decisionSession: { gte: new Date(`${since.toISOString().slice(0, 10)}T00:00:00.000Z`) },
      OR: [{ credit: { gt: 0 } }, { credit: { lt: 0 } }],
    },
  });
}

/**
 * The candidate book's sessions since the cutoff whose fitness row charged turnover (fill
 * friction). Counting the LIVE book let a challenger that never traded pass the gate.
 */
export async function countTurnoverSessions(branchId: string, since: Date): Promise<number> {
  return prisma.fitnessSnapshot.count({
    where: { branchId, session: { gt: since }, turnoverDelta: { gt: 0 } },
  });
}

/**
 * Lower bound of the paired series — same floor `runEvolutionEvaluate` uses.
 * A deposed champion's own evidenceCutoff predates the promotion, so the branch
 * RESET is what marks where this trial actually starts.
 */
export function evolutionEvidenceCutoff(
  candidate: { evidenceCutoff: Date | null; createdAt: Date },
  resetAt: Date,
): Date {
  return new Date(
    Math.max((candidate.evidenceCutoff ?? candidate.createdAt).getTime(), resetAt.getTime()),
  );
}

/** PAPER decisions on each book since the paired-series cutoff. */
export async function countPaperDecisionsSinceCutoff(cutoff: Date): Promise<{
  candidate: number;
  live: number;
}> {
  const [candidate, live] = await Promise.all([
    prisma.decisionReview.count({
      where: { branch: "CANDIDATE", book: "PAPER", createdAt: { gt: cutoff } },
    }),
    prisma.decisionReview.count({
      where: { branch: "LIVE", book: "PAPER", createdAt: { gt: cutoff } },
    }),
  ]);
  return { candidate, live };
}

/** Stored snapshot columns → the benchmark-free increment every pairing caller uses. */
export function pairingIncrementOf(row: {
  dailyIncrement: Prisma.Decimal | null;
  avoidedCreditDelta: Prisma.Decimal;
  turnoverDelta: Prisma.Decimal;
}): number | null {
  return pairingIncrement({
    dailyIncrement: decToNum(row.dailyIncrement),
    avoidedCreditDelta: decToNum(row.avoidedCreditDelta) ?? 0,
    turnoverDelta: decToNum(row.turnoverDelta) ?? 0,
  });
}

export type PairableSnapshot = {
  /** Benchmark-free increment (`pairingIncrementOf`) — the CSPX term cancels in the pair. */
  fitnessIncrement: number | null;
  maxDrawdown: number;
  nav: number;
};

export type PairedFitnessSeries = {
  dailyDeltas: number[];
  candidateMaxDrawdown: number;
  liveMaxDrawdown: number;
  latestCandidateNav: number;
  latestCandidateSessionMs: number | undefined;
};

/**
 * Pair OK snapshots that share a session and differ their fitness increments.
 * Worst rolling drawdown on each book during the paired window is kept — a
 * mid-trial blow-up that later rolls off must still block crowning.
 */
export function pairFitnessIncrements(
  candRows: Map<number, PairableSnapshot>,
  liveRows: Map<number, PairableSnapshot>,
): PairedFitnessSeries {
  const dailyDeltas: number[] = [];
  let candidateMaxDrawdown = 0;
  let liveMaxDrawdown = 0;
  for (const [session, cand] of candRows) {
    const live = liveRows.get(session);
    if (!live) continue;
    if (cand.fitnessIncrement === null || live.fitnessIncrement === null) continue;
    dailyDeltas.push(cand.fitnessIncrement - live.fitnessIncrement);
    if (cand.maxDrawdown > candidateMaxDrawdown) candidateMaxDrawdown = cand.maxDrawdown;
    if (live.maxDrawdown > liveMaxDrawdown) liveMaxDrawdown = live.maxDrawdown;
  }
  const latestCandidateSessionMs = [...candRows.keys()].sort((a, b) => b - a)[0];
  const latestCandidateNav =
    latestCandidateSessionMs !== undefined
      ? (candRows.get(latestCandidateSessionMs)?.nav ?? 0)
      : 0;
  return {
    dailyDeltas,
    candidateMaxDrawdown,
    liveMaxDrawdown,
    latestCandidateNav,
    latestCandidateSessionMs,
  };
}

export type EvolutionEvaluateDetail = {
  candidateId: number | null;
  skipped?: string;
  verdict?: CandidateVerdict;
  lane?: RuleLane;
  sessions?: number;
  decisions?: number;
  liveDecisions?: number;
  thresholds?: EvolutionThresholds;
  z?: number | null;
  delta?: number;
  se?: number;
  candidateMaxDrawdown?: number;
  liveMaxDrawdown?: number;
  branchMaxDrawdown?: number;
  promotionsIn90d?: number;
  promotedVersionId?: number;
  retiredVersionId?: number;
  resolvedNonZeroCredits?: number;
  turnoverSessions?: number;
};

export async function runEvolutionEvaluate(_ctx: JobContext): Promise<JobResult> {
  // The ops pause only ever withholds promotion (and the kills that would end a test on
  // evidence gathered while paused). Kernel §18 reversion is never deferred, so the
  // drawdown checks below run regardless.
  const paused = await isEvolutionPromotePaused();

  const active = await prisma.ruleVersion.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { id: "desc" },
  });
  if (!active) {
    // Without an incumbent there is nothing to compare against and nothing to depose.
    return { done: true, detail: { candidateId: null, skipped: "no_active" } };
  }

  const branches = await prisma.shadowBranch.findMany({
    select: { id: true, branch: true, highWaterNav: true, ruleVersionId: true, resetAt: true },
  });
  const candidateBranch = branches.find((b) => b.branch === "CANDIDATE");
  const liveBranch = branches.find((b) => b.branch === "LIVE");
  if (!candidateBranch || !liveBranch) {
    return { done: true, detail: { candidateId: null, skipped: "no_shadow_branches" } };
  }

  // Kernel §18 — "any branch": the LIVE book is checked first, before (and without) a
  // challenger, and whether or not promotion is paused.
  const liveBreach = await hardRevertOnLiveBreach(liveBranch, candidateBranch, active);
  if (liveBreach) return { done: true, detail: liveBreach as Prisma.InputJsonValue };

  // The challenger is whoever the CANDIDATE BRANCH POINTS AT — a status-CANDIDATE row, or
  // the deposed champion running the revert series. Keying on status CANDIDATE made the
  // revert series unevaluable: it skipped `no_candidate` forever and the deposed champion's
  // rules never got the chance to win their book back.
  const target = await prisma.ruleVersion.findUnique({
    where: { id: candidateBranch.ruleVersionId },
  });
  const legitimacy = challengerLegitimacy(target, active);
  if (!legitimacy.ok || !target) {
    if (legitimacy.ok === false && legitimacy.inconsistent) {
      console.error(
        "[evolution evaluate] CANDIDATE pointer is illegitimate",
        `version ${candidateBranch.ruleVersionId} (${legitimacy.reason})`,
      );
    }
    return {
      done: true,
      detail: { candidateId: null, skipped: paused ? "promote_paused" : "no_candidate" },
    };
  }
  const candidate = target;

  // Lower bound of the paired series. A DEPOSED CHAMPION's own evidenceCutoff predates the
  // promotion by its whole tenure, so its cutoff alone would drag in sessions it ran as the
  // incumbent; the branch RESET is what marks where the revert series actually starts. Taking
  // the max also hardens a fresh candidate (its reset and its cutoff are the same instant)
  // and closes cross-attribution: sessions a PREDECESSOR candidate traded on this book are
  // always before this challenger's reset and can never be inherited.
  const cutoff = evolutionEvidenceCutoff(candidate, candidateBranch.resetAt);

  const rows = await prisma.fitnessSnapshot.findMany({
    where: {
      branchId: { in: [candidateBranch.id, liveBranch.id] },
      session: { gt: cutoff },
      quality: "OK",
    },
    select: {
      branchId: true,
      session: true,
      nav: true,
      dailyIncrement: true,
      avoidedCreditDelta: true,
      turnoverDelta: true,
      maxDrawdown: true,
    },
    orderBy: { session: "asc" },
  });

  const candRows = new Map<number, PairableSnapshot>();
  const liveRows = new Map<number, PairableSnapshot>();
  for (const r of rows) {
    const target = r.branchId === candidateBranch.id ? candRows : liveRows;
    target.set(r.session.getTime(), {
      fitnessIncrement: pairingIncrementOf(r),
      maxDrawdown: decToNum(r.maxDrawdown) ?? 0,
      nav: decToNum(r.nav) ?? 0,
    });
  }

  const {
    dailyDeltas,
    candidateMaxDrawdown,
    liveMaxDrawdown,
    latestCandidateNav,
  } = pairFitnessIncrements(candRows, liveRows);

  const thresholds = await getEvolutionThresholds();
  const [paperDecisions, promotionsIn90d] = await Promise.all([
    countPaperDecisionsSinceCutoff(cutoff),
    countEvolutionEvents({
      kind: "PROMOTE",
      since: new Date(Date.now() - thresholds.promotionRateWindowDays * 86_400_000),
    }),
  ]);
  const decisions = paperDecisions.candidate;
  const liveDecisions = paperDecisions.live;

  // The kernel drawdown floor is checked against the CANDIDATE BOOK's live drawdown from
  // its own high-water mark, not the snapshot series' worst historical dip.
  const highWater = decToNum(candidateBranch.highWaterNav) ?? 0;
  const branchMaxDrawdown =
    highWater > 0 && latestCandidateNav > 0
      ? Math.max(0, (highWater - latestCandidateNav) / highWater)
      : 0;

  const { z, delta, se, n } = sequentialZ(dailyDeltas);
  const lane: RuleLane = candidate.lane ?? "SLOW";
  let verdict = evaluateCandidate({
    z,
    sessions: n,
    decisions,
    liveDecisions,
    lane,
    candidateMaxDrawdown,
    liveMaxDrawdown,
    branchMaxDrawdown,
    promotionsIn90d,
    thresholds,
  });

  const stats = {
    z,
    n,
    delta,
    se,
    decisions,
    liveDecisions,
    thresholds,
    lane,
    candidateMaxDrawdown,
    liveMaxDrawdown,
    branchMaxDrawdown,
    promotionsIn90d,
  };

  // A challenger whose book has taken exactly the same actions as LIVE's for a full
  // early-kill window cannot be told apart by the paired test (every delta is the same
  // market move on both sides), and would otherwise hold the only slot until the 50-session
  // INCONCLUSIVE — e.g. a rule that only relabels outcomes. End it now.
  let reason: string | undefined;
  if (
    verdict === "CONTINUE" &&
    n >= thresholds.earlyKill.minSessions &&
    !(await booksDiverged(candidateBranch.id, liveBranch.id, cutoff))
  ) {
    verdict = "INCONCLUSIVE";
    reason = "no_divergence";
  }

  const baseDetail: EvolutionEvaluateDetail = {
    candidateId: candidate.id,
    verdict,
    lane,
    sessions: n,
    decisions,
    liveDecisions,
    thresholds,
    z,
    delta,
    se,
    candidateMaxDrawdown,
    liveMaxDrawdown,
    branchMaxDrawdown,
    promotionsIn90d,
  };

  if (paused && verdict !== "HARD_REVERT") {
    return {
      done: true,
      detail: {
        ...baseDetail,
        verdict: "CONTINUE",
        pausedVerdict: verdict,
        skipped: "promote_paused",
      } as unknown as Prisma.InputJsonValue,
    };
  }

  // CONTINUE is the steady state — writing an event every day it holds would bury the
  // state CHANGES that matter. The job ledger detail already records the daily numbers.
  if (verdict === "CONTINUE") {
    return { done: true, detail: baseDetail as unknown as Prisma.InputJsonValue };
  }

  if (verdict === "PROMOTE") {
    // Credit gate only blocks crowning — kills/reverts must still run while credit is dark.
    const [resolvedNonZeroCredits, turnoverSessions] = await Promise.all([
      countResolvedNonZeroCredits(candidateBranch.id, cutoff),
      countTurnoverSessions(candidateBranch.id, cutoff),
    ]);
    if (resolvedNonZeroCredits < thresholds.minResolvedNonzeroCredits) {
      return {
        done: true,
        detail: {
          ...baseDetail,
          verdict: "CONTINUE",
          skipped: "counterfactual_credit_gate",
          resolvedNonZeroCredits,
          turnoverSessions,
        } as unknown as Prisma.InputJsonValue,
      };
    }
    if (turnoverSessions < thresholds.minTurnoverSessions) {
      return {
        done: true,
        detail: {
          ...baseDetail,
          verdict: "CONTINUE",
          skipped: "turnover_not_charging",
          resolvedNonZeroCredits,
          turnoverSessions,
        } as unknown as Prisma.InputJsonValue,
      };
    }

    const promoted = await promote(candidate, active, stats);
    if (!promoted.ok) {
      return {
        done: true,
        detail: {
          ...baseDetail,
          verdict: "CONTINUE",
          skipped: promoted.reason,
        } as unknown as Prisma.InputJsonValue,
      };
    }
    return {
      done: true,
      detail: {
        ...baseDetail,
        promotedVersionId: candidate.id,
        retiredVersionId: active.id,
        resolvedNonZeroCredits,
        turnoverSessions,
      } as unknown as Prisma.InputJsonValue,
    };
  }

  // EARLY_KILL / HARD_REVERT / INCONCLUSIVE all end the experiment the same way: the
  // challenger stops running and its paper book restarts under the incumbent ruleset.
  //
  // Only a status-CANDIDATE row is KILLED. A deposed champion that loses its revert series
  // was a legitimate ruleset that already retired honestly — it stays RETIRED; ending the
  // series is just the branch reset.
  if (legitimacy.kind === "CANDIDATE") {
    const killed = await prisma.ruleVersion.updateMany({
      where: { id: candidate.id, status: "CANDIDATE" },
      data: { status: "KILLED", retiredAt: new Date() },
    });
    if (killed.count !== 1) {
      return {
        done: true,
        detail: {
          ...baseDetail,
          skipped: "candidate_changed",
        } as unknown as Prisma.InputJsonValue,
      };
    }
  }
  await resetBranch("CANDIDATE", active.id);
  await appendEvolutionEvent({
    kind: verdict,
    ruleVersionId: candidate.id,
    actor: "CRON",
    detail: {
      ...stats,
      ...(reason ? { reason } : {}),
      revertedToVersionId: active.id,
      challengerKind: legitimacy.kind,
    } as unknown as Prisma.InputJsonValue,
  });

  return { done: true, detail: baseDetail as unknown as Prisma.InputJsonValue };
}

/**
 * Kernel §18 on the LIVE book: 25% or more below its own high-water mark hard-reverts.
 * The in-flight challenger is killed. If the incumbent got there by an automatic
 * promotion, LIVE reverts to the version it deposed (the last known-good the system
 * itself chose); a human-published incumbent is kept — the system does not pick a
 * "known-good" ruleset over a human choice — and the breach is logged for review. Both
 * books restart under the incumbent so a still-breached high-water mark cannot re-fire
 * the revert every night.
 */
async function hardRevertOnLiveBreach(
  liveBranch: { id: string; highWaterNav: Prisma.Decimal },
  candidateBranch: { ruleVersionId: number },
  active: { id: number; parentId: number | null },
): Promise<Record<string, unknown> | null> {
  const latest = await prisma.fitnessSnapshot.findFirst({
    where: { branchId: liveBranch.id },
    orderBy: { session: "desc" },
    select: { nav: true, session: true },
  });
  const highWater = decToNum(liveBranch.highWaterNav) ?? 0;
  const nav = decToNum(latest?.nav ?? null) ?? 0;
  const drawdown = highWater > 0 && nav > 0 ? Math.max(0, (highWater - nav) / highWater) : 0;
  if (drawdown < KERNEL_DRAWDOWN_FLOOR) return null;

  const killed = await prisma.ruleVersion.updateMany({
    where: { id: candidateBranch.ruleVersionId, status: "CANDIDATE" },
    data: { status: "KILLED", retiredAt: new Date() },
  });

  let revertedToVersionId: number | null = null;
  const promotedAutomatically = await prisma.evolutionEvent.findFirst({
    where: { kind: "PROMOTE", ruleVersionId: active.id },
    select: { id: true },
  });
  if (promotedAutomatically && active.parentId !== null) {
    const parent = await prisma.ruleVersion.findUnique({ where: { id: active.parentId } });
    if (parent?.status === "RETIRED") {
      const reverted = await promote(parent, active, {
        liveHardRevert: true,
        drawdown,
      });
      if (reverted.ok) revertedToVersionId = parent.id;
    }
  }

  const incumbentId = revertedToVersionId ?? active.id;
  await resetBranch("LIVE", incumbentId);
  await resetBranch("CANDIDATE", incumbentId);
  const detail = {
    branch: "LIVE",
    drawdown,
    nav,
    highWaterNav: highWater,
    session: latest?.session.toISOString().slice(0, 10) ?? null,
    killedCandidateId: killed.count === 1 ? candidateBranch.ruleVersionId : null,
    revertedToVersionId,
    automaticRevert: revertedToVersionId !== null,
  };
  await appendEvolutionEvent({
    kind: "HARD_REVERT",
    ruleVersionId: active.id,
    actor: "CRON",
    detail: detail as unknown as Prisma.InputJsonValue,
  });
  return { candidateId: null, verdict: "HARD_REVERT", ...detail };
}

/**
 * Whether the two books have acted differently since the cutoff: orders (ticker, side,
 * decision session — resets excluded) and refusals seeded as counterfactuals (ticker,
 * decision type, decision session). Pre-cutoff rows copied in at a clone are excluded by
 * the session floor.
 */
async function booksDiverged(
  candidateBranchId: string,
  liveBranchId: string,
  cutoff: Date,
): Promise<boolean> {
  const since = new Date(`${cutoff.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const branchIds = [candidateBranchId, liveBranchId];
  const [orders, refusals] = await Promise.all([
    prisma.shadowOrder.findMany({
      where: {
        branchId: { in: branchIds },
        decisionSession: { gte: since },
        OR: [{ rejectReason: null }, { rejectReason: { not: "branch_reset" } }],
      },
      select: { branchId: true, ticker: true, side: true, decisionSession: true },
    }),
    prisma.counterfactual.findMany({
      where: {
        branchId: { in: branchIds },
        horizonSessions: COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS,
        decisionSession: { gte: since },
      },
      select: { branchId: true, ticker: true, decisionType: true, decisionSession: true },
    }),
  ]);
  const keys = (branchId: string) => [
    ...orders
      .filter((o) => o.branchId === branchId)
      .map((o) => `order|${o.ticker}|${o.side}|${o.decisionSession.toISOString().slice(0, 10)}`),
    ...refusals
      .filter((r) => r.branchId === branchId)
      .map(
        (r) =>
          `refusal|${r.ticker}|${r.decisionType}|${r.decisionSession.toISOString().slice(0, 10)}`,
      ),
  ];
  return actionsDiffer(keys(candidateBranchId), keys(liveBranchId));
}

type PromoteResult = { ok: true } | { ok: false; reason: string };

async function promote(
  candidate: {
    id: number;
    status: RuleStatus;
    limits: Prisma.JsonValue;
    lane: RuleLane | null;
    changedPaths: Prisma.JsonValue;
  },
  active: { id: number; parentId: number | null },
  stats: Record<string, unknown>,
): Promise<PromoteResult> {
  const candidateId = candidate.id;
  const activeId = active.id;
  const candidateLimits = candidate.limits;
  /**
   * A REVERT is not a separate mechanism — it is the deposed champion WINNING its pairing.
   * Same transaction, same PROMOTE event kind; only the detail records that the promoted
   * version is the one the incumbent deposed (HARD_REVERT stays reserved for the drawdown
   * floor breach, which is a kill, not a promotion).
   */
  const isRevert = candidateId === active.parentId;
  // Conditioned on the status we actually resolved: a fresh candidate is CANDIDATE, a
  // deposed champion is RETIRED. Never a bare "whatever it is now".
  const expectedStatus = candidate.status;

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      // Retire the incumbent first — the partial unique index allows one ACTIVE row.
      const retired = await tx.ruleVersion.updateMany({
        where: { id: activeId, status: "ACTIVE" },
        data: { status: "RETIRED", retiredAt: now },
      });
      if (retired.count !== 1) throw new Error("rule_version_race");

      const activated = await tx.ruleVersion.updateMany({
        where: { id: candidateId, status: expectedStatus },
        // retiredAt is cleared: a version back in service has no retirement date, and
        // scoring reads retiredAt as the end of a tenure.
        data: { status: "ACTIVE", activatedAt: now, retiredAt: null },
      });
      if (activated.count !== 1) throw new Error("rule_version_race");

      // REAL-MONEY-ADJACENT STEP. logTrade enforces Config.LIMITS on the REAL book, while
      // planning reads the versioned ruleset's limits. Writing both in one transaction is
      // what keeps planning and enforcement in lockstep — a promoted ruleset that planned
      // to a 0.18 cap while log_trade still refused at 0.15 would desync the two surfaces.
      // The move is bounded three ways before it ever reaches here: the FAST_LANE_PARAMS
      // hard ranges, the 90-day/v1 drift rails + consecutive-loosening ratchet at propose
      // time, and the promotion-rate rail inside evaluateCandidate (Config.EVOLUTION_THRESHOLDS).
      await tx.config.upsert({
        where: { key: CONFIG_KEYS.LIMITS },
        create: { key: CONFIG_KEYS.LIMITS, value: candidateLimits as Prisma.InputJsonValue },
        update: { value: candidateLimits as Prisma.InputJsonValue },
      });

      await appendEvolutionEvent(
        {
          kind: "PROMOTE",
          ruleVersionId: candidateId,
          actor: "CRON",
          detail: {
            ...stats,
            retiredVersionId: activeId,
            changedPaths: candidate.changedPaths,
            ...(isRevert ? { revert: true, revertOf: activeId } : {}),
          } as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
    });
  } catch (err) {
    if (err instanceof Error && err.message === "rule_version_race") {
      return { ok: false, reason: "rule_version_race" };
    }
    throw err;
  }

  clearRuleSetCache();
  // Re-points LIVE at the promoted version…
  await ensureShadowBranches();
  // The deposed champion (or the new incumbent after a revert) becomes the challenger.
  // Clone LIVE's paper book into CANDIDATE so both books start identical — only the
  // rules differ. Kill / HARD_REVERT / INCONCLUSIVE keep resetBranch (idle $100k book).
  //
  // After a REVERT there is nothing left to re-litigate — the challenger that just lost was
  // itself the challenger's challenger — so the book goes idle on the new incumbent instead
  // of starting a third round of the same duel. (Pointing it at the loser would also be
  // illegitimate: the loser is not the new ACTIVE's parentId.)
  await cloneBranchBook("LIVE", "CANDIDATE", isRevert ? candidateId : activeId);

  const mirror = await mirrorRuleVersion(candidateId);
  await appendEvolutionEvent({
    kind: "MIRROR",
    ruleVersionId: candidateId,
    actor: "CRON",
    detail: { via: "evolution_evaluate", ...mirror } as unknown as Prisma.InputJsonValue,
  });

  return { ok: true };
}
