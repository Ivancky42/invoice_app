/**
 * Read-only views of the evolution surface for agents (MCP + HTTP).
 *
 * NOTE: these views NEVER return `RuleVersion.files`. The prompt corpus is served through
 * `get_prompt` / `get_context`, which resolve the branch the caller is actually running;
 * handing an agent the raw text of an arbitrary version would let it reconstruct and
 * re-propose a killed ruleset verbatim while dodging the changedPaths-based ban.
 *
 * `list_rule_sections` is the exception that proves the rule: it returns section ids +
 * sha256 digests (and heading lines) so proposers can pin `expectedSectionSha`, but never
 * the section body.
 */
import type { Branch, RuleStatus } from "@/generated/prisma/client";
import {
  inventorySections,
  normaliseRuleFile,
  type SectionMeta,
} from "@/lib/evolution/sections";
import { prisma } from "@/lib/prisma";
import { KERNEL_CLAUSES } from "@/lib/rules/kernelClauses";
import { challengerLegitimacy } from "@/lib/rules/challenger";
import {
  RULE_FILE_NAMES,
  filesFromRow,
  mergeCandidateFiles,
} from "@/lib/rules/resolve";

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

export type ListRuleSectionsInput = {
  branch?: Branch;
  /** Prompt file name, with or without `.md`. */
  file?: string;
};

export type ListRuleSectionsResult =
  | {
      ok: true;
      branch: Branch;
      versionId: number;
      /**
       * True when digests match what `propose_rule_change` / `apply_gap_fix` pin
       * against (the ACTIVE row, read the same way the writers do — no getRuleSet cache
       * / disk degrade). False for CANDIDATE inspection.
       */
      writePin: boolean;
      /** Per-file section index. Keys always include the `.md` suffix. */
      files: Record<string, SectionMeta[]>;
      note: string;
    }
  | {
      ok: false;
      status: 400 | 409;
      reason: string;
      details?: Record<string, unknown>;
    };

/**
 * Section ids + shas. Default (`branch=LIVE` or omitted) reads the ACTIVE RuleVersion
 * row directly — same source `propose_rule_change` / `apply_gap_fix` pin against.
 * `branch=CANDIDATE` is inspection-only (`writePin: false`); do not use those shas on writes.
 * Body text stays on `get_prompt`.
 */
export async function listRuleSections(
  input: ListRuleSectionsInput = {},
): Promise<ListRuleSectionsResult> {
  let fileFilter: string | null = null;
  if (input.file !== undefined) {
    fileFilter = normaliseRuleFile(input.file);
    if (!fileFilter) {
      return {
        ok: false,
        status: 400,
        reason: "unknown_rule_file",
        details: { file: input.file, allowed: [...RULE_FILE_NAMES] },
      };
    }
  }

  const inventory = (fileMap: Record<string, string>): Record<string, SectionMeta[]> => {
    const files: Record<string, SectionMeta[]> = {};
    for (const name of RULE_FILE_NAMES) {
      if (fileFilter && name !== fileFilter) continue;
      files[name] = inventorySections(fileMap[name] ?? "");
    }
    return files;
  };

  // Writers always pin ACTIVE via prisma — match that path (no 60s cache, no disk degrade).
  if (input.branch !== "CANDIDATE") {
    const active = await prisma.ruleVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { id: "desc" },
      select: { id: true, files: true },
    });
    if (!active) {
      return { ok: false, status: 409, reason: "no_active_rule_version" };
    }
    return {
      ok: true,
      branch: "LIVE",
      versionId: active.id,
      writePin: true,
      files: inventory(filesFromRow(active.files)),
      note:
        "writePin=true: pass sectionId + sha256 as expectedSectionSha on propose_rule_change / " +
        "apply_gap_fix. newText must be the full section (heading included). Body: get_prompt.",
    };
  }

  // CANDIDATE inspection — merged challenger view; shas are NOT the write pin target.
  const [pointer, active] = await Promise.all([
    prisma.shadowBranch.findUnique({
      where: { branch: "CANDIDATE" },
      select: { ruleVersionId: true },
    }),
    prisma.ruleVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { id: "desc" },
      select: { id: true, parentId: true, files: true },
    }),
  ]);
  if (!active) {
    return { ok: false, status: 409, reason: "no_active_rule_version" };
  }
  const target = pointer
    ? await prisma.ruleVersion.findUnique({
        where: { id: pointer.ruleVersionId },
        select: { id: true, status: true, files: true },
      })
    : null;
  const legitimacy = challengerLegitimacy(target, active);
  const challenger = legitimacy.ok ? target : null;
  const fileMap = challenger
    ? mergeCandidateFiles(filesFromRow(active.files), filesFromRow(challenger.files))
    : filesFromRow(active.files);

  return {
    ok: true,
    branch: "CANDIDATE",
    versionId: challenger?.id ?? active.id,
    writePin: false,
    files: inventory(fileMap),
    note:
      "writePin=false: CANDIDATE inspection only. propose_rule_change / apply_gap_fix pin ACTIVE — " +
      "call list_rule_sections without branch (or branch=LIVE) for expectedSectionSha.",
  };
}
