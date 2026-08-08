/**
 * Read-only views of the evolution surface for agents (MCP + HTTP).
 *
 * NOTE: these views NEVER return `RuleVersion.files`. The prompt corpus is served through
 * `get_prompt` / `get_context`, which resolve the branch the caller is actually running;
 * handing an agent the raw text of an arbitrary version would let it reconstruct and
 * re-propose a killed ruleset verbatim while dodging the changedPaths-based ban.
 */
import type { RuleStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { KERNEL_CLAUSES } from "@/lib/rules/kernelClauses";

const METADATA_SELECT = {
  id: true,
  status: true,
  lane: true,
  actor: true,
  parentId: true,
  limits: true,
  changeSummary: true,
  changedPaths: true,
  evidenceCutoff: true,
  reasoningPattern: true,
  successMetric: true,
  counterCase: true,
  direction: true,
  scope: true,
  outcome: true,
  outcomeDetail: true,
  createdAt: true,
  activatedAt: true,
  retiredAt: true,
} as const;

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export async function getRuleVersion(id: number) {
  const row = await prisma.ruleVersion.findUnique({
    where: { id },
    select: METADATA_SELECT,
  });
  if (!row) return { ok: false as const, status: 404, reason: "rule_version_not_found" };
  return {
    ok: true as const,
    ruleVersion: {
      ...row,
      evidenceCutoff: iso(row.evidenceCutoff),
      createdAt: iso(row.createdAt),
      activatedAt: iso(row.activatedAt),
      retiredAt: iso(row.retiredAt),
    },
  };
}

export type ListRuleVersionsInput = { status?: RuleStatus; limit?: number };

/** Metadata only, newest first. Default 20, hard cap 100. */
export async function listRuleVersions(input: ListRuleVersionsInput = {}) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const rows = await prisma.ruleVersion.findMany({
    where: input.status ? { status: input.status } : undefined,
    orderBy: { id: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      lane: true,
      actor: true,
      parentId: true,
      changeSummary: true,
      changedPaths: true,
      direction: true,
      scope: true,
      outcome: true,
      reasoningPattern: true,
      createdAt: true,
      activatedAt: true,
      retiredAt: true,
    },
  });
  return {
    ruleVersions: rows.map((r) => ({
      ...r,
      createdAt: iso(r.createdAt),
      activatedAt: iso(r.activatedAt),
      retiredAt: iso(r.retiredAt),
    })),
  };
}

/**
 * The kernel, verbatim, from the DEPLOYED bundle — so an agent can read the boundary
 * BEFORE proposing rather than discovering it as a KERNEL_ATTEMPT rejection.
 * Changing any of this requires a human commit; no tool can.
 */
export function getKernel() {
  return {
    clauses: KERNEL_CLAUSES.map((c) => ({
      id: c.id,
      sha256: c.sha256,
      canonicalText: c.canonicalText,
    })),
    note:
      "Kernel clauses are pinned in the deployed bundle (src/lib/rules/kernelClauses.ts). " +
      "Any proposal that edits a line inside a KERNEL fence is rejected and logged.",
  };
}
