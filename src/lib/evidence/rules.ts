/**
 * Evidence-tier acceptance rules for Decision Review writes (Commit 8 — warn-only ships
 * first; strict is a flag flip). PURE — no prisma.
 *
 * Tier semantics: prompts/_shared.md §9 ("Signal tiers") defines BUY *signal* categories
 * (Standard / EARLY ENTRY / QUALITY REBOUND), not evidence-*source* strength — there is no
 * literal T1–T4 prose in this repo's prompts today. This module instead mirrors the
 * "tier-1/2 (primary) evidence" language already used at the hasTier12Evidence call site
 * (src/lib/fitness/math.ts / breadthClassify.ts) and documents the kind→tier convention on
 * the EvidenceTier/EvidenceKind enums in prisma/schema.prisma: T1/T2 = primary-source
 * (filings, earnings calls, management guidance, primary data / credible secondary
 * reporting on those events), T3 = social sentiment, T4 = price action / inference / other
 * — never sufficient alone. See the task's final report for the full mapping + rationale.
 */
import type {
  DecisionType,
  EvidenceKind,
  EvidenceTier,
  MoveClass,
  ThesisState,
} from "@/generated/prisma/enums";
import { classifyDecisionType } from "@/lib/shadow/orders";

export type EvidenceEnforcement = "warn" | "strict";

export type EvidenceCode =
  | "T12_REQUIRED_FOR_ACTION"
  | "T1_REQUIRED_FOR_THESIS_CHANGE"
  | "T4_NEVER_SUFFICIENT"
  | "PRICE_NOT_EVIDENCE"
  | "INFERENCE_NOT_EVIDENCE"
  | "STALE_EVIDENCE"
  | "MOVE_CLASS_BLOCKS_THESIS_CHANGE";

export type EvidenceInputItem = {
  tier: EvidenceTier;
  kind: EvidenceKind;
  observedAt: Date;
};

export type CheckEvidenceLimits = {
  evidenceRecencyDays: number;
  evidenceStaleDays: number;
};

export type CheckEvidenceInput = {
  decisionType: DecisionType | null | undefined;
  thesisState: ThesisState | null | undefined;
  priorThesisState: ThesisState | null | undefined;
  moveClass: MoveClass | null | undefined;
  evidence: EvidenceInputItem[];
  now: Date;
  limits: CheckEvidenceLimits;
  enforcement: EvidenceEnforcement;
};

export type CheckEvidenceResult = {
  failures: EvidenceCode[];
  warnings: EvidenceCode[];
};

/** Kinds that satisfy nothing tier-wise, even at T1/T2 — they can be present, just inert. */
const EXCLUDED_KINDS = new Set<EvidenceKind>(["PRICE_ACTION", "INFERENCE"]);

function ageDays(observedAt: Date, now: Date): number {
  return (now.getTime() - observedAt.getTime()) / 86_400_000;
}

type ItemContribution =
  | "satisfies"
  | "satisfies-stale-warn"
  | "excluded-kind"
  | "stale-fail"
  | "wrong-tier";

function contributionFor(
  item: EvidenceInputItem,
  allowedTiers: EvidenceTier[],
  now: Date,
  limits: CheckEvidenceLimits,
): ItemContribution {
  // Kind BEFORE tier: PRICE_ACTION/INFERENCE satisfy nothing at any tier, and their
  // conventional tier is T4 — testing tier first would return "wrong-tier" for the common
  // case and make the specific PRICE_NOT_EVIDENCE/INFERENCE_NOT_EVIDENCE feedback
  // unreachable except for off-convention T1/T2 items.
  if (EXCLUDED_KINDS.has(item.kind)) return "excluded-kind";
  if (!allowedTiers.includes(item.tier)) return "wrong-tier";
  const age = ageDays(item.observedAt, now);
  // Beyond evidenceStaleDays: satisfies nothing, regardless of kind.
  if (age > limits.evidenceStaleDays) return "stale-fail";
  if (age > limits.evidenceRecencyDays) return "satisfies-stale-warn";
  return "satisfies";
}

type RequirementEval = {
  met: boolean;
  /** At least one item satisfied only via the recency→stale warn window. */
  staleWarn: boolean;
  /** Requirement failed and PRICE_ACTION item(s) were cited (at any tier). */
  onlyPriceAction: boolean;
  /** Requirement failed and INFERENCE item(s) were cited (at any tier). */
  onlyInference: boolean;
};

/** Evaluate "≥1 item of one of `allowedTiers`" against the evidence set. */
function evaluateRequirement(
  evidence: EvidenceInputItem[],
  allowedTiers: EvidenceTier[],
  now: Date,
  limits: CheckEvidenceLimits,
): RequirementEval {
  let met = false;
  let staleWarn = false;
  let sawExcludedPrice = false;
  let sawExcludedInference = false;

  for (const item of evidence) {
    const contribution = contributionFor(item, allowedTiers, now, limits);
    if (contribution === "satisfies") {
      met = true;
    } else if (contribution === "satisfies-stale-warn") {
      met = true;
      staleWarn = true;
    } else if (contribution === "excluded-kind") {
      if (item.kind === "PRICE_ACTION") sawExcludedPrice = true;
      if (item.kind === "INFERENCE") sawExcludedInference = true;
    }
  }

  return {
    met,
    staleWarn,
    onlyPriceAction: !met && sawExcludedPrice,
    onlyInference: !met && sawExcludedInference,
  };
}

/**
 * Check one Decision Review write's cited evidence against tier requirements.
 *
 * `enforcement === "warn"`: every applicable code lands in `warnings`, nothing in
 * `failures` (caller still persists the write).
 * `enforcement === "strict"`: codes land in `failures` EXCEPT `STALE_EVIDENCE`, which stays
 * a warning even in strict mode (a satisfied-but-aging requirement is not a hard block).
 */
export function checkEvidence(input: CheckEvidenceInput): CheckEvidenceResult {
  const { decisionType, thesisState, priorThesisState, moveClass, evidence, now, limits, enforcement } =
    input;

  const codes: EvidenceCode[] = [];
  const pureWarnCodes = new Set<EvidenceCode>(["STALE_EVIDENCE"]);

  const isExposureChange = classifyDecisionType(decisionType).kind !== "none";
  // Both sides must be known: a fresh DR (priorThesisState null) has nothing to compare
  // against yet — see the bootstrap comment at the upsertDecisionReview call site.
  const isThesisChange =
    thesisState != null && priorThesisState != null && thesisState !== priorThesisState;

  // T4_NEVER_SUFFICIENT — evidence was cited, but every item is T4 (weakest tier alone).
  // Only meaningful where a tier requirement actually applies: a HOLD/no-op DR citing a
  // single T4 context item requires nothing, so flagging it would hard-fail an otherwise
  // valid write in strict mode.
  if (
    (isExposureChange || isThesisChange) &&
    evidence.length > 0 &&
    evidence.every((e) => e.tier === "T4")
  ) {
    codes.push("T4_NEVER_SUFFICIENT");
  }

  // T12_REQUIRED_FOR_ACTION — decisions that change exposure need ≥1 T1/T2 item.
  if (isExposureChange) {
    const req = evaluateRequirement(evidence, ["T1", "T2"], now, limits);
    if (!req.met) {
      codes.push("T12_REQUIRED_FOR_ACTION");
      if (req.onlyPriceAction) codes.push("PRICE_NOT_EVIDENCE");
      if (req.onlyInference) codes.push("INFERENCE_NOT_EVIDENCE");
    }
    if (req.staleWarn) codes.push("STALE_EVIDENCE");
  }

  // T1_REQUIRED_FOR_THESIS_CHANGE — a thesis-state change needs ≥1 T1 item specifically.
  if (isThesisChange) {
    const req = evaluateRequirement(evidence, ["T1"], now, limits);
    if (!req.met) {
      codes.push("T1_REQUIRED_FOR_THESIS_CHANGE");
      if (req.onlyPriceAction) codes.push("PRICE_NOT_EVIDENCE");
      if (req.onlyInference) codes.push("INFERENCE_NOT_EVIDENCE");
    }
    if (req.staleWarn) codes.push("STALE_EVIDENCE");

    // MOVE_CLASS_BLOCKS_THESIS_CHANGE — a MARKET_MOVE-attributed name needs a T1/T2 item
    // that plausibly post-dates the move. We do not carry the move's own date on the DR,
    // so `now − evidenceRecencyDays` is used as the freshness proxy (comment per task spec).
    if (moveClass === "MARKET_MOVE") {
      const cutoff = new Date(now.getTime() - limits.evidenceRecencyDays * 86_400_000);
      const hasFreshT12 = evidence.some(
        (e) =>
          (e.tier === "T1" || e.tier === "T2") &&
          !EXCLUDED_KINDS.has(e.kind) &&
          e.observedAt >= cutoff,
      );
      if (!hasFreshT12) codes.push("MOVE_CLASS_BLOCKS_THESIS_CHANGE");
    }
  }

  const uniqueCodes = [...new Set(codes)];

  if (enforcement === "warn") {
    return { failures: [], warnings: uniqueCodes };
  }

  return {
    failures: uniqueCodes.filter((c) => !pureWarnCodes.has(c)),
    warnings: uniqueCodes.filter((c) => pureWarnCodes.has(c)),
  };
}
