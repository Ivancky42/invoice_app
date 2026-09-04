/**
 * Read-only views of the fitness ledger for the agent surface (MCP + HTTP).
 * Reads FitnessSnapshot / Counterfactual / ShadowBranch / DecisionReview / Config —
 * no real-book state. Thresholds and PAPER decision counts match evolution_evaluate.
 */
import type { Branch, CounterfactualStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEvolutionThresholds, type EvolutionThresholds } from "@/lib/stocks/config";
import { decToNum } from "@/lib/stocks/format";

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function day(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export type GetShadowFitnessInput = {
  branch?: Branch;
  limit?: number;
};

async function paperDecisionsSinceCandidateCutoff(): Promise<{
  LIVE: number;
  CANDIDATE: number;
}> {
  const candidateBranch = await prisma.shadowBranch.findUnique({
    where: { branch: "CANDIDATE" },
    select: { resetAt: true, ruleVersionId: true },
  });
  if (!candidateBranch) return { LIVE: 0, CANDIDATE: 0 };

  const version = await prisma.ruleVersion.findUnique({
    where: { id: candidateBranch.ruleVersionId },
    select: { evidenceCutoff: true, createdAt: true },
  });
  // Same floor evolution_evaluate pairs from: max(version cutoff, branch reset).
  const cutoff = new Date(
    Math.max(
      (version?.evidenceCutoff ?? version?.createdAt ?? candidateBranch.resetAt).getTime(),
      candidateBranch.resetAt.getTime(),
    ),
  );
  const where = { book: "PAPER" as const, createdAt: { gt: cutoff } };
  const [LIVE, CANDIDATE] = await Promise.all([
    prisma.decisionReview.count({ where: { ...where, branch: "LIVE" } }),
    prisma.decisionReview.count({ where: { ...where, branch: "CANDIDATE" } }),
  ]);
  return { LIVE, CANDIDATE };
}

/** Fitness snapshots for one branch, newest session first. */
export async function getShadowFitness(input: GetShadowFitnessInput = {}) {
  const branch = input.branch ?? "LIVE";
  const limit = Math.min(input.limit ?? 30, 90);
  const [branchRow, thresholds, decisionsSinceCutoff] = await Promise.all([
    prisma.shadowBranch.findUnique({
      where: { branch },
      select: { id: true },
    }),
    getEvolutionThresholds(),
    paperDecisionsSinceCandidateCutoff(),
  ]);
  const extras: {
    thresholds: EvolutionThresholds;
    decisionsSinceCutoff: { LIVE: number; CANDIDATE: number };
  } = { thresholds, decisionsSinceCutoff };

  if (!branchRow) return { branch, snapshots: [], ...extras };

  const rows = await prisma.fitnessSnapshot.findMany({
    where: { branchId: branchRow.id },
    orderBy: { session: "desc" },
    take: limit,
  });

  return {
    branch,
    snapshots: rows.map((s) => ({
      session: day(s.session),
      nav: decToNum(s.nav),
      dailyIncrement: decToNum(s.dailyIncrement),
      avoidedCreditDelta: decToNum(s.avoidedCreditDelta),
      benchmarkIncrement: decToNum(s.benchmarkIncrement),
      fitnessIncrement: decToNum(s.fitnessIncrement),
      windowFitness: decToNum(s.windowFitness),
      maxDrawdown: decToNum(s.maxDrawdown),
      turnoverDelta: decToNum(s.turnoverDelta),
      quality: s.quality,
      staleMarks: s.staleMarks,
      openPositions: s.openPositions,
      createdAt: iso(s.createdAt),
    })),
    ...extras,
  };
}

export type ListCounterfactualsInput = {
  branch?: Branch;
  status?: CounterfactualStatus;
  limit?: number;
};

/** Counterfactuals for one branch, newest decision session first. */
export async function listCounterfactuals(input: ListCounterfactualsInput = {}) {
  const branch = input.branch ?? "LIVE";
  const limit = Math.min(input.limit ?? 50, 200);
  const branchRow = await prisma.shadowBranch.findUnique({
    where: { branch },
    select: { id: true },
  });
  if (!branchRow) return { branch, counterfactuals: [] };

  const rows = await prisma.counterfactual.findMany({
    where: {
      branchId: branchRow.id,
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: [{ decisionSession: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return {
    branch,
    counterfactuals: rows.map((c) => ({
      id: c.id,
      ticker: c.ticker,
      decisionType: c.decisionType,
      decisionReviewId: c.decisionReviewId,
      decisionSession: day(c.decisionSession),
      horizonSessions: c.horizonSessions,
      priceAtDecision: decToNum(c.priceAtDecision),
      permittedSize: decToNum(c.permittedSize),
      horizonSession: day(c.horizonSession),
      priceAtHorizon: decToNum(c.priceAtHorizon),
      horizonReturn: decToNum(c.horizonReturn),
      credit: decToNum(c.credit),
      status: c.status,
      createdAt: iso(c.createdAt),
    })),
  };
}
