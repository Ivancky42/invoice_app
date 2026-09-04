/**
 * Pure helpers for a human publish of on-disk /prompts as a new ACTIVE RuleVersion.
 *
 * The script (`scripts/publish-rule-version.ts`) owns the DB transaction. This module
 * decides whether that write may proceed and builds the payloads it will persist.
 */
import { reapplyCandidateHunks, rebaseDecision } from "@/lib/evolution/gapfix";
import { findSection, sectionIds } from "@/lib/evolution/sections";
import { diffLines } from "@/lib/rules/diff";
import { RULE_FILE_NAMES, sha256Hex } from "@/lib/rules/resolve";

export const DEFAULT_PUBLISH_SUMMARY = "Human edit: plain-language output format";

export function ruleFilesIdentical(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  for (const name of RULE_FILE_NAMES) {
    if ((a[name] ?? "") !== (b[name] ?? "")) return false;
  }
  return true;
}

export function changedRuleFiles(
  a: Record<string, string>,
  b: Record<string, string>,
): string[] {
  return RULE_FILE_NAMES.filter((name) => (a[name] ?? "") !== (b[name] ?? ""));
}

export function corpusDiffLineCount(
  a: Record<string, string>,
  b: Record<string, string>,
): number {
  let n = 0;
  for (const name of RULE_FILE_NAMES) {
    const diff = diffLines(a[name] ?? "", b[name] ?? "");
    n += diff.added + diff.removed;
  }
  return n;
}

/** Same `prompts:<file>#<section>` paths propose / gap-fix record on a RuleVersion. */
export function changedSectionPaths(
  oldFiles: Record<string, string>,
  newFiles: Record<string, string>,
): string[] {
  const paths: string[] = [];
  for (const name of RULE_FILE_NAMES) {
    const oldText = oldFiles[name] ?? "";
    const newText = newFiles[name] ?? "";
    if (oldText === newText) continue;
    const stem = name.replace(/\.md$/, "");
    const ids = new Set([...sectionIds(oldText), ...sectionIds(newText)]);
    let anySection = false;
    for (const id of ids) {
      const a = findSection(oldText, id)?.text ?? "";
      const b = findSection(newText, id)?.text ?? "";
      if (a !== b) {
        paths.push(`prompts:${stem}#${id}`);
        anySection = true;
      }
    }
    if (!anySection) paths.push(`prompts:${stem}`);
  }
  return paths.sort();
}

export type PublishDecision =
  | { action: "noop" }
  | {
      action: "abort";
      reason: "conflict";
      publishChangedPaths: string[];
      candidateChangedPaths: string[];
    }
  | {
      action: "proceed";
      publishChangedPaths: string[];
      changedFiles: string[];
      diffLineCount: number;
      rebase: boolean;
    };

/**
 * Decide whether a disk → ACTIVE publish may proceed.
 *
 * `conflict` when the in-flight candidate rewrote a section this publish also
 * touches — there is no honest merge, so the script must abort (not kill).
 */
export function decidePublish(args: {
  diskFiles: Record<string, string>;
  activeFiles: Record<string, string>;
  candidateChangedPaths: readonly string[] | null;
}): PublishDecision {
  if (ruleFilesIdentical(args.diskFiles, args.activeFiles)) return { action: "noop" };

  const publishChangedPaths = changedSectionPaths(args.activeFiles, args.diskFiles);
  const changedFiles = changedRuleFiles(args.activeFiles, args.diskFiles);
  const diffLineCount = corpusDiffLineCount(args.activeFiles, args.diskFiles);

  if (args.candidateChangedPaths && args.candidateChangedPaths.length > 0) {
    if (rebaseDecision(args.candidateChangedPaths, publishChangedPaths) === "conflict") {
      return {
        action: "abort",
        reason: "conflict",
        publishChangedPaths,
        candidateChangedPaths: [...args.candidateChangedPaths],
      };
    }
  }

  return {
    action: "proceed",
    publishChangedPaths,
    changedFiles,
    diffLineCount,
    rebase: args.candidateChangedPaths !== null,
  };
}

export type PublishedActivePayload = {
  status: "ACTIVE";
  actor: "HUMAN";
  parentId: number;
  lane: null;
  direction: "NEUTRAL";
  files: Record<string, string>;
  fileShas: Record<string, string>;
  changeSummary: string;
  changedPaths: string[];
};

export function buildPublishedActivePayload(args: {
  parentId: number;
  files: Record<string, string>;
  changeSummary: string;
  changedPaths: string[];
}): PublishedActivePayload {
  const fileShas = Object.fromEntries(
    Object.entries(args.files).map(([name, text]) => [name, sha256Hex(text)]),
  );
  return {
    status: "ACTIVE",
    actor: "HUMAN",
    parentId: args.parentId,
    lane: null,
    direction: "NEUTRAL",
    files: args.files,
    fileShas,
    changeSummary: args.changeSummary,
    changedPaths: args.changedPaths,
  };
}

export type RebasedCandidateClone = {
  parentId: number;
  files: Record<string, string>;
  fileShas: Record<string, string>;
  changeSummary: string;
  changedPaths: string[];
};

/**
 * Kill-then-create payload for the in-flight candidate, with its hunks re-applied
 * onto the newly published ACTIVE. `parentId` is the new ACTIVE id.
 */
export function buildRebasedCandidateClone(args: {
  newActiveId: number;
  newActiveFiles: Record<string, string>;
  candidateFiles: Record<string, string>;
  candidateChangedPaths: readonly string[];
  changeSummary: string | null;
}): RebasedCandidateClone {
  const files = reapplyCandidateHunks(
    args.newActiveFiles,
    args.candidateFiles,
    args.candidateChangedPaths,
  );
  const fileShas = Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, sha256Hex(text)]),
  );
  const base = (args.changeSummary ?? "").trim();
  const suffix = `(rebased onto v${args.newActiveId})`;
  const changeSummary = base.length > 0 ? `${base} ${suffix}` : suffix;
  return {
    parentId: args.newActiveId,
    files,
    fileShas,
    changeSummary,
    changedPaths: [...args.candidateChangedPaths],
  };
}

/** EARLY_KILL detail for a candidate that was kill-then-created onto a human publish. */
export type EarlyKillPublishDetail = {
  reason: "rebased";
  publishChangedPaths: string[];
  candidateChangedPaths: string[];
  newActiveId: number;
  newCandidateId: number;
  human: true;
};

export function earlyKillPublishDetail(args: {
  publishChangedPaths: readonly string[];
  candidateChangedPaths: readonly string[];
  newActiveId: number;
  newCandidateId: number;
}): EarlyKillPublishDetail {
  return {
    reason: "rebased",
    publishChangedPaths: [...args.publishChangedPaths],
    candidateChangedPaths: [...args.candidateChangedPaths],
    newActiveId: args.newActiveId,
    newCandidateId: args.newCandidateId,
    human: true,
  };
}

/** GAPFIX detail for a human publish (no HUMAN_PUBLISH kind exists). */
export type PublishGapfixDetail = {
  human: true;
  fromVersionId: number;
  toVersionId: number;
  rebasedCandidate: { from: number; to: number } | null;
  candidateAction: "rebased" | "none";
};

export function publishGapfixDetail(args: {
  fromVersionId: number;
  toVersionId: number;
  rebasedCandidate: { from: number; to: number } | null;
}): PublishGapfixDetail {
  return {
    human: true,
    fromVersionId: args.fromVersionId,
    toVersionId: args.toVersionId,
    rebasedCandidate: args.rebasedCandidate,
    candidateAction: args.rebasedCandidate ? "rebased" : "none",
  };
}
