/**
 * `apply_gap_fix`: an immediate, small prose patch to the ACTIVE ruleset.
 *
 * A gap-fix is NOT a candidate. It exists for typos, internal contradictions and
 * clarifications — cases where waiting 30 sessions for a shadow trial would leave the live
 * routine reading something wrong. The containment is that it is small (≤40 changed lines),
 * section-scoped with a REQUIRED sha (so it cannot silently clobber concurrent edits), and
 * subject to every kernel gate a proposal faces.
 *
 * Rule versions are IMMUTABLE, so "rebasing" the in-flight candidate means kill-then-create,
 * and the partial unique index (one CANDIDATE per lane) forces that ordering inside the
 * transaction.
 */
import type { Prisma } from "@/generated/prisma/client";
import { appendEvolutionEvent } from "@/lib/evolution/log";
import {
  findSection,
  normaliseRuleFile,
  replaceSection,
  sectionIds,
} from "@/lib/evolution/propose";
import { prisma } from "@/lib/prisma";
import { changedLinesInside, diffLines } from "@/lib/rules/diff";
import { mirrorRuleVersion } from "@/lib/rules/gitMirror";
import { fenceRanges, scanForbiddenPatterns } from "@/lib/rules/kernel";
import {
  RULE_FILE_NAMES,
  clearRuleSetCache,
  filesFromRow,
  kernelGate,
  sha256Hex,
} from "@/lib/rules/resolve";
import { ensureShadowBranches, resetBranch } from "@/lib/shadow/branches";

/** Changed lines a gap-fix may touch. Beyond this it is a rule change, not a correction. */
export const GAPFIX_BUDGET_LINES = 40;

export type RebaseDecision = "conflict" | "rebase";

/**
 * Can the in-flight candidate survive this gap-fix?
 *
 * PURE. `conflict` when the gap-fix touched a section the candidate also rewrote — the two
 * edits are to the same prose and there is no honest way to merge them, so the candidate
 * dies and its evidence is discarded. Otherwise the candidate's own hunks are re-applied on
 * top of the corrected ACTIVE text.
 */
export function rebaseDecision(
  candidateChangedPaths: readonly string[],
  gapfixChangedPaths: readonly string[],
): RebaseDecision {
  const touched = new Set(gapfixChangedPaths);
  return candidateChangedPaths.some((p) => touched.has(p)) ? "conflict" : "rebase";
}

export type ApplyGapFixInput = {
  file: string;
  sectionId: string;
  /** REQUIRED — a gap-fix without a sha is a blind overwrite of live prose. */
  expectedSectionSha: string;
  newText: string;
  reason: string;
};

export type ApplyGapFixFailure = {
  ok: false;
  status: number;
  reason: string;
  details?: Record<string, unknown>;
};

export type ApplyGapFixSuccess = {
  ok: true;
  ruleVersionId: number;
  retiredVersionId: number;
  changedLines: number;
  changedPaths: string[];
  candidate:
    | { action: "none" }
    | { action: "killed"; killedVersionId: number }
    | { action: "rebased"; killedVersionId: number; newCandidateId: number };
  mirror: { ok: boolean; skipped?: string; error?: string };
};

function changedPathsOf(row: { changedPaths: Prisma.JsonValue }): string[] {
  return Array.isArray(row.changedPaths)
    ? (row.changedPaths as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
}

export async function applyGapFix(
  input: ApplyGapFixInput,
): Promise<ApplyGapFixSuccess | ApplyGapFixFailure> {
  const file = normaliseRuleFile(input.file);
  if (!file) {
    return {
      ok: false,
      status: 400,
      reason: "unknown_rule_file",
      details: { file: input.file, allowed: [...RULE_FILE_NAMES] },
    };
  }

  const [active, candidate] = await Promise.all([
    prisma.ruleVersion.findFirst({ where: { status: "ACTIVE" }, orderBy: { id: "desc" } }),
    prisma.ruleVersion.findFirst({ where: { status: "CANDIDATE" }, orderBy: { id: "desc" } }),
  ]);
  if (!active) return { ok: false, status: 409, reason: "no_active_rule_version" };

  const activeFiles = filesFromRow(active.files);
  const current = activeFiles[file] ?? "";
  const slice = findSection(current, input.sectionId);
  if (!slice) {
    return {
      ok: false,
      status: 404,
      reason: "section_not_found",
      details: { file, sectionId: input.sectionId },
    };
  }
  const actualSha = sha256Hex(slice.text);
  if (actualSha !== input.expectedSectionSha) {
    return {
      ok: false,
      status: 409,
      reason: "section_sha_mismatch",
      details: { file, sectionId: input.sectionId, actualSha },
    };
  }

  const patchedText = replaceSection(current, input.sectionId, input.newText);
  if (patchedText === null) {
    return {
      ok: false,
      status: 404,
      reason: "section_not_found",
      details: { file, sectionId: input.sectionId },
    };
  }
  const newFiles = { ...activeFiles, [file]: patchedText };

  // --- Gates (same set and order as propose) ------------------------------
  const gapfixPath = `prompts:${file.replace(/\.md$/, "")}#${input.sectionId}`;
  const reject = async (
    status: number,
    reason: string,
    details?: Record<string, unknown>,
  ): Promise<ApplyGapFixFailure> => {
    await appendEvolutionEvent({
      kind: "KERNEL_ATTEMPT",
      ruleVersionId: active.id,
      actor: "AGENT",
      detail: {
        reason,
        via: "apply_gap_fix",
        gapfixReason: input.reason,
        path: gapfixPath,
        ...(details ?? {}),
      } as Prisma.InputJsonValue,
    });
    return { ok: false, status, reason, details };
  };

  const gate = kernelGate(newFiles);
  if (!gate.ok) {
    const first = gate.violations[0];
    return reject(409, "kernel_violation", {
      clauseIds: gate.clauseIds,
      file: first?.file ?? null,
      line: first?.line ?? null,
      violations: gate.violations,
    });
  }

  const diff = diffLines(current, patchedText);
  const changedLines = diff.added + diff.removed;
  const inside = [
    ...changedLinesInside(fenceRanges(activeFiles)[file] ?? [], diff).a,
    ...changedLinesInside(fenceRanges(newFiles)[file] ?? [], diff).b,
  ];
  if (inside.length > 0) {
    return reject(409, "kernel_fence_edited", { file, line: inside[0] });
  }

  const forbidden = scanForbiddenPatterns(newFiles);
  if (forbidden.length > 0) {
    const first = forbidden[0];
    return reject(409, "forbidden_pattern", {
      pattern: first.pattern,
      file: first.file,
      line: first.line,
      hits: forbidden,
    });
  }

  if (changedLines > GAPFIX_BUDGET_LINES) {
    return reject(400, "gapfix_budget_exceeded", {
      changedLines,
      budget: GAPFIX_BUDGET_LINES,
    });
  }

  const before = new Set(sectionIds(current));
  const after = new Set(sectionIds(patchedText));
  const deleted = [...before].filter((id) => !after.has(id));
  if (deleted.length > 0) {
    return reject(400, "section_deleted", { file, sections: deleted });
  }

  // --- Candidate rebase plan (computed before the transaction) -------------
  const candidatePaths = candidate ? changedPathsOf(candidate) : [];
  const decision: RebaseDecision | null = candidate
    ? rebaseDecision(candidatePaths, [gapfixPath])
    : null;

  let rebasedFiles: Record<string, string> | null = null;
  if (candidate && decision === "rebase") {
    // Re-apply the candidate's own prose hunks on top of the corrected ACTIVE text. Sections
    // the candidate never touched therefore pick up the gap-fix; ones it did keep its wording.
    const candidateFiles = filesFromRow(candidate.files);
    const next = { ...newFiles };
    for (const path of candidatePaths) {
      if (!path.startsWith("prompts:")) continue;
      const [rawFile, section] = path.slice("prompts:".length).split("#");
      const target = normaliseRuleFile(rawFile);
      if (!target) continue;
      const source = candidateFiles[target] ?? "";
      if (!section) {
        next[target] = source;
        continue;
      }
      const candidateSlice = findSection(source, section);
      if (!candidateSlice) continue;
      const applied = replaceSection(next[target] ?? "", section, candidateSlice.text);
      if (applied !== null) next[target] = applied;
    }
    const rebaseGate = kernelGate(next);
    if (!rebaseGate.ok || scanForbiddenPatterns(next).length > 0) {
      // The merge produced an invalid corpus — treat it exactly like a textual conflict.
      rebasedFiles = null;
    } else {
      rebasedFiles = next;
    }
  }
  const effectiveDecision: RebaseDecision | null =
    candidate === null ? null : rebasedFiles ? "rebase" : "conflict";

  const now = new Date();
  const newShas = Object.fromEntries(
    Object.entries(newFiles).map(([name, text]) => [name, sha256Hex(text)]),
  );

  type TxResult = {
    newActiveId: number;
    killedCandidateId: number | null;
    newCandidateId: number | null;
  };

  let tx: TxResult;
  try {
    tx = await prisma.$transaction(async (client) => {
      // Retire first: the partial unique index allows only one ACTIVE row.
      const retired = await client.ruleVersion.updateMany({
        where: { id: active.id, status: "ACTIVE" },
        data: { status: "RETIRED", retiredAt: now },
      });
      if (retired.count !== 1) throw new Error("rule_version_race");

      const created = await client.ruleVersion.create({
        data: {
          status: "ACTIVE",
          lane: active.lane,
          actor: "AGENT",
          parentId: active.id,
          files: newFiles as unknown as Prisma.InputJsonValue,
          fileShas: newShas as unknown as Prisma.InputJsonValue,
          limits: active.limits as Prisma.InputJsonValue,
          changeSummary: `gap-fix: ${input.reason}`,
          changedPaths: [gapfixPath] as unknown as Prisma.InputJsonValue,
          // A gap-fix corrects the CURRENT ruleset; it inherits the incumbent's evidence
          // window rather than restarting it, so the live comparison series is unbroken.
          evidenceCutoff: active.evidenceCutoff,
          // A GAP-FIX IS NOT AN EXPERIMENT, so it carries no experimental provenance.
          // Inheriting the incumbent's reasoningPattern let one experiment plus its own
          // typo-fixes accumulate the two HURT rows that retire a pattern — the experiment
          // would retire its own hypothesis by being corrected. Null keeps gap-fixes out of
          // the pattern-retirement groupBy entirely (it filters `reasoningPattern != null`).
          reasoningPattern: null,
          successMetric: null,
          counterCase: null,
          direction: "NEUTRAL",
          scope: active.scope,
          activatedAt: now,
        },
        select: { id: true },
      });

      let killedCandidateId: number | null = null;
      let newCandidateId: number | null = null;

      if (candidate) {
        const killed = await client.ruleVersion.updateMany({
          where: { id: candidate.id, status: "CANDIDATE" },
          data: { status: "KILLED", retiredAt: now },
        });
        if (killed.count !== 1) throw new Error("rule_version_race");
        killedCandidateId = candidate.id;

        if (effectiveDecision === "rebase" && rebasedFiles) {
          const rebasedShas = Object.fromEntries(
            Object.entries(rebasedFiles).map(([name, text]) => [name, sha256Hex(text)]),
          );
          const newCandidate = await client.ruleVersion.create({
            data: {
              status: "CANDIDATE",
              lane: candidate.lane,
              actor: "AGENT",
              parentId: created.id,
              files: rebasedFiles as unknown as Prisma.InputJsonValue,
              fileShas: rebasedShas as unknown as Prisma.InputJsonValue,
              limits: candidate.limits as Prisma.InputJsonValue,
              changeSummary: candidate.changeSummary,
              changedPaths: candidate.changedPaths as Prisma.InputJsonValue,
              // Carried, not restamped: the challenger keeps the evidence it has already
              // earned — the gap-fix changed prose it never claimed.
              evidenceCutoff: candidate.evidenceCutoff,
              // The rebased clone KEEPS its own provenance: it is the SAME experiment,
              // merely re-expressed on top of the corrected prose.
              reasoningPattern: candidate.reasoningPattern,
              successMetric: candidate.successMetric,
              counterCase: candidate.counterCase,
              direction: candidate.direction,
              scope: candidate.scope,
            },
            select: { id: true },
          });
          newCandidateId = newCandidate.id;
        }

        await appendEvolutionEvent(
          {
            kind: "EARLY_KILL",
            ruleVersionId: candidate.id,
            actor: "AGENT",
            detail: {
              reason: effectiveDecision === "rebase" ? "rebased" : "rebase_conflict",
              gapfixPath,
              candidateChangedPaths: candidatePaths,
              newActiveId: created.id,
              newCandidateId,
            } as Prisma.InputJsonValue,
          },
          client,
        );
      }

      await appendEvolutionEvent(
        {
          kind: "GAPFIX",
          ruleVersionId: created.id,
          actor: "AGENT",
          detail: {
            parentId: active.id,
            file,
            sectionId: input.sectionId,
            changedLines,
            reason: input.reason,
            changedPaths: [gapfixPath],
            candidateAction: candidate ? effectiveDecision : "none",
          } as Prisma.InputJsonValue,
        },
        client,
      );

      return { newActiveId: created.id, killedCandidateId, newCandidateId };
    });
  } catch (err) {
    if (err instanceof Error && err.message === "rule_version_race") {
      return {
        ok: false,
        status: 409,
        reason: "rule_version_race",
        details: { message: "ACTIVE/CANDIDATE changed mid-gapfix; nothing was written" },
      };
    }
    throw err;
  }

  clearRuleSetCache();
  if (tx.newCandidateId !== null) {
    // Point the challenger branch at the rebased clone BEFORE reconciliation. Pointer only:
    // the clone is the SAME experiment, so it keeps the book and the `resetAt` that bounds
    // its evidence — resetBranch would throw both away. Leaving the pointer on the killed
    // predecessor would make it briefly illegitimate.
    await prisma.shadowBranch.updateMany({
      where: { branch: "CANDIDATE" },
      data: { ruleVersionId: tx.newCandidateId },
    });
  }
  await ensureShadowBranches();
  if (candidate && effectiveDecision === "conflict") {
    // The challenger is gone; its paper book must not keep trading the dead ruleset.
    await resetBranch("CANDIDATE", tx.newActiveId);
  }

  const mirror = await mirrorRuleVersion(tx.newActiveId);
  await appendEvolutionEvent({
    kind: "MIRROR",
    ruleVersionId: tx.newActiveId,
    actor: "AGENT",
    detail: { via: "apply_gap_fix", ...mirror } as Prisma.InputJsonValue,
  });

  return {
    ok: true,
    ruleVersionId: tx.newActiveId,
    retiredVersionId: active.id,
    changedLines,
    changedPaths: [gapfixPath],
    candidate:
      tx.killedCandidateId === null
        ? { action: "none" }
        : tx.newCandidateId === null
          ? { action: "killed", killedVersionId: tx.killedCandidateId }
          : {
              action: "rebased",
              killedVersionId: tx.killedCandidateId,
              newCandidateId: tx.newCandidateId,
            },
    mirror,
  };
}
