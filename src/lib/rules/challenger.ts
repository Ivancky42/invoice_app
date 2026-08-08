/**
 * Who is the CURRENT CHALLENGER? PURE — no prisma, no I/O.
 *
 * The `ShadowBranch.CANDIDATE` pointer is the source of truth for "the version the
 * challenger book is running". Status alone is not enough: after a promotion the deposed
 * champion keeps running on the challenger branch so the new rules must beat the rules
 * they replaced (the REVERT SERIES), and that version's status is RETIRED, not CANDIDATE.
 *
 * Resolving off status instead of the pointer is what made the revert series unreachable:
 * `getRuleSet("CANDIDATE")` fell back to ACTIVE, `evolution_evaluate` skipped with
 * `no_candidate`, and `ensureShadowBranches` reconciled the pointer back to ACTIVE on the
 * next tick. This predicate is the ONE definition both of those sites now share.
 */
import type { RuleStatus } from "@/generated/prisma/client";

/** The version a branch pointer targets. */
export type ChallengerTarget = { id: number; status: RuleStatus };

/** The incumbent. `parentId` is what identifies the version it deposed. */
export type IncumbentRef = { id: number; parentId: number | null };

export type ChallengerLegitimacy =
  | {
      ok: true;
      /** CANDIDATE = a live experiment; DEPOSED_CHAMPION = the revert series. */
      kind: "CANDIDATE" | "DEPOSED_CHAMPION";
    }
  | {
      ok: false;
      reason:
        | "missing"
        | "no_active"
        /** The pointer sits on the incumbent: the branch is IDLE, which is normal. */
        | "is_active"
        | "killed"
        | "stale_retired"
        | "unexpected_status";
      /**
       * True only when the pointer state should never have happened. `missing`,
       * `no_active` and `is_active` are ordinary lifecycle states and are NOT logged as
       * errors — an idle challenger book is the steady state between experiments.
       */
      inconsistent: boolean;
    };

/**
 * Is the version the CANDIDATE branch points at a legitimate challenger?
 *
 * Legitimate iff EITHER it is a status-CANDIDATE row (a proposal under test), OR it is
 * RETIRED and it is the version the current ACTIVE one deposed (`ACTIVE.parentId`) — the
 * immediately-deposed champion, and nothing older. A KILLED target, a RETIRED version from
 * some earlier generation, or a missing pointer is illegitimate and the caller must fall
 * back to (or reconcile to) ACTIVE.
 */
export function challengerLegitimacy(
  target: ChallengerTarget | null | undefined,
  active: IncumbentRef | null | undefined,
): ChallengerLegitimacy {
  if (!active) return { ok: false, reason: "no_active", inconsistent: false };
  if (!target) return { ok: false, reason: "missing", inconsistent: false };
  // Checked before status so the idle book (pointer parked on the incumbent after a kill
  // or a revert) is never mistaken for an inconsistency.
  if (target.id === active.id) return { ok: false, reason: "is_active", inconsistent: false };

  if (target.status === "CANDIDATE") return { ok: true, kind: "CANDIDATE" };
  if (target.status === "RETIRED") {
    return target.id === active.parentId
      ? { ok: true, kind: "DEPOSED_CHAMPION" }
      : { ok: false, reason: "stale_retired", inconsistent: true };
  }
  if (target.status === "KILLED") {
    return { ok: false, reason: "killed", inconsistent: true };
  }
  return { ok: false, reason: "unexpected_status", inconsistent: true };
}

/** Convenience boolean for call sites that only need the verdict. */
export function isLegitimateChallenger(
  target: ChallengerTarget | null | undefined,
  active: IncumbentRef | null | undefined,
): boolean {
  return challengerLegitimacy(target, active).ok;
}
