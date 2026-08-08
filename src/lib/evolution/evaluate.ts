/**
 * `evolution_evaluate` (daily, after `fitness_snapshot`): the only code path that can
 * promote a ruleset, and the only one that can kill a candidate on evidence.
 *
 * The comparison is PAIRED and DIFFERENCED per session: for every session where both
 * branches produced an OK snapshot, delta = candidate.fitnessIncrement − live.fitnessIncrement.
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
import { evaluateCandidate, sequentialZ, type CandidateVerdict } from "@/lib/fitness/math";
import { prisma } from "@/lib/prisma";
import { challengerLegitimacy } from "@/lib/rules/challenger";
import { mirrorRuleVersion } from "@/lib/rules/gitMirror";
import { clearRuleSetCache } from "@/lib/rules/resolve";
import { ensureShadowBranches, resetBranch } from "@/lib/shadow/branches";
import { CONFIG_KEYS, getConfig } from "@/lib/stocks/config";
import { decToNum } from "@/lib/stocks/format";

/** Window the promotion rate limit is measured over. */
const PROMOTION_RATE_WINDOW_DAYS = 90;

/** Config / env key: set to `"0"` / `false` to freeze promotion until a clean re-replay. */
export const EVOLUTION_PROMOTE_KEY = "EVOLUTION_PROMOTE";

/**
 * Hard readiness gate: do not promote while avoided-loss credit is still dark.
 * Counts RESOLVED counterfactuals whose signed credit is non-zero (either sign).
 */
export const MIN_RESOLVED_NONZERO_CREDITS_FOR_PROMOTE = 20;

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

/** RESOLVED interim-horizon rows with non-zero signed credit (readiness for promotion). */
export async function countResolvedNonZeroCredits(): Promise<number> {
  return prisma.counterfactual.count({
    where: {
      status: "RESOLVED",
      horizonSessions: COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS,
      OR: [{ credit: { gt: 0 } }, { credit: { lt: 0 } }],
    },
  });
}

export type EvolutionEvaluateDetail = {
  candidateId: number | null;
  skipped?: string;
  verdict?: CandidateVerdict;
  lane?: RuleLane;
  sessions?: number;
  decisions?: number;
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
};

export async function runEvolutionEvaluate(_ctx: JobContext): Promise<JobResult> {
  if (await isEvolutionPromotePaused()) {
    return {
      done: true,
      detail: { candidateId: null, skipped: "promote_paused" },
    };
  }

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
    return { done: true, detail: { candidateId: null, skipped: "no_candidate" } };
  }
  const candidate = target;

  // Lower bound of the paired series. A DEPOSED CHAMPION's own evidenceCutoff predates the
  // promotion by its whole tenure, so its cutoff alone would drag in sessions it ran as the
  // incumbent; the branch RESET is what marks where the revert series actually starts. Taking
  // the max also hardens a fresh candidate (its reset and its cutoff are the same instant)
  // and closes cross-attribution: sessions a PREDECESSOR candidate traded on this book are
  // always before this challenger's reset and can never be inherited.
  const cutoff = new Date(
    Math.max(
      (candidate.evidenceCutoff ?? candidate.createdAt).getTime(),
      candidateBranch.resetAt.getTime(),
    ),
  );

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
      fitnessIncrement: true,
      maxDrawdown: true,
    },
    orderBy: { session: "asc" },
  });

  type Row = { fitnessIncrement: number | null; maxDrawdown: number; nav: number };
  const candRows = new Map<number, Row>();
  const liveRows = new Map<number, Row>();
  for (const r of rows) {
    const target = r.branchId === candidateBranch.id ? candRows : liveRows;
    target.set(r.session.getTime(), {
      fitnessIncrement: decToNum(r.fitnessIncrement),
      maxDrawdown: decToNum(r.maxDrawdown) ?? 0,
      nav: decToNum(r.nav) ?? 0,
    });
  }

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

  const [decisions, promotionsIn90d] = await Promise.all([
    prisma.decisionReview.count({
      where: { branch: "CANDIDATE", createdAt: { gt: cutoff } },
    }),
    countEvolutionEvents({
      kind: "PROMOTE",
      since: new Date(Date.now() - PROMOTION_RATE_WINDOW_DAYS * 86_400_000),
    }),
  ]);

  // The kernel drawdown floor is checked against the CANDIDATE BOOK's live drawdown from
  // its own high-water mark, not the snapshot series' worst historical dip.
  const highWater = decToNum(candidateBranch.highWaterNav) ?? 0;
  const latestSession = [...candRows.keys()].sort((a, b) => b - a)[0];
  const latestNav = latestSession !== undefined ? (candRows.get(latestSession)?.nav ?? 0) : 0;
  const branchMaxDrawdown =
    highWater > 0 && latestNav > 0 ? Math.max(0, (highWater - latestNav) / highWater) : 0;

  const { z, delta, se, n } = sequentialZ(dailyDeltas);
  const lane: RuleLane = candidate.lane ?? "SLOW";
  const verdict = evaluateCandidate({
    z,
    sessions: n,
    decisions,
    lane,
    candidateMaxDrawdown,
    liveMaxDrawdown,
    branchMaxDrawdown,
    promotionsIn90d,
  });

  const stats = {
    z,
    n,
    delta,
    se,
    decisions,
    lane,
    candidateMaxDrawdown,
    liveMaxDrawdown,
    branchMaxDrawdown,
    promotionsIn90d,
  };

  const baseDetail: EvolutionEvaluateDetail = {
    candidateId: candidate.id,
    verdict,
    lane,
    sessions: n,
    decisions,
    z,
    delta,
    se,
    candidateMaxDrawdown,
    liveMaxDrawdown,
    branchMaxDrawdown,
    promotionsIn90d,
  };

  // CONTINUE is the steady state — writing an event every day it holds would bury the
  // state CHANGES that matter. The job ledger detail already records the daily numbers.
  if (verdict === "CONTINUE") {
    return { done: true, detail: baseDetail as unknown as Prisma.InputJsonValue };
  }

  if (verdict === "PROMOTE") {
    // Credit gate only blocks crowning — kills/reverts must still run while credit is dark.
    const resolvedNonZeroCredits = await countResolvedNonZeroCredits();
    if (resolvedNonZeroCredits < MIN_RESOLVED_NONZERO_CREDITS_FOR_PROMOTE) {
      return {
        done: true,
        detail: {
          ...baseDetail,
          verdict: "CONTINUE",
          skipped: "counterfactual_credit_gate",
          resolvedNonZeroCredits,
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
      revertedToVersionId: active.id,
      challengerKind: legitimacy.kind,
    } as unknown as Prisma.InputJsonValue,
  });

  return { done: true, detail: baseDetail as unknown as Prisma.InputJsonValue };
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
      // time, and the 8-promotions-per-90-days rail inside evaluateCandidate.
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
  // …and the DEPOSED CHAMPION becomes the challenger: its book restarts under the version
  // that just lost, so the next comparison is "new champion vs the rules it replaced".
  //
  // After a REVERT there is nothing left to re-litigate — the challenger that just lost was
  // itself the challenger's challenger — so the book goes IDLE on the new incumbent instead
  // of starting a third round of the same duel. (Pointing it at the loser would also be
  // illegitimate: the loser is not the new ACTIVE's parentId.)
  await resetBranch("CANDIDATE", isRevert ? candidateId : activeId);

  const mirror = await mirrorRuleVersion(candidateId);
  await appendEvolutionEvent({
    kind: "MIRROR",
    ruleVersionId: candidateId,
    actor: "CRON",
    detail: { via: "evolution_evaluate", ...mirror } as unknown as Prisma.InputJsonValue,
  });

  return { ok: true };
}
