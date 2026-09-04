/**
 * One-time human publish: write the committed /prompts files as a new ACTIVE
 * RuleVersion, retire the prior ACTIVE, and rebase any in-flight CANDIDATE
 * (abort on section conflict — never kill it).
 *
 * Usage:
 *   npx tsx scripts/publish-rule-version.ts --dry-run
 *   npx tsx scripts/publish-rule-version.ts --confirm-destructive
 *   npx tsx scripts/publish-rule-version.ts --confirm-destructive --summary "…"
 *
 * Remote/prod DATABASE_URL requires `--confirm-destructive`. Never commit prod URLs.
 * After a successful publish: npx tsx scripts/verify-rule-parity.ts
 */
import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import { appendEvolutionEvent } from "../src/lib/evolution/log";
import { changedPathsOf } from "../src/lib/evolution/gapfix";
import { prisma } from "../src/lib/prisma";
import { mirrorRuleVersion } from "../src/lib/rules/gitMirror";
import { scanForbiddenPatterns } from "../src/lib/rules/kernel";
import {
  buildPublishedActivePayload,
  buildRebasedCandidateClone,
  decidePublish,
  DEFAULT_PUBLISH_SUMMARY,
  earlyKillPublishDetail,
  publishGapfixDetail,
} from "../src/lib/rules/publish";
import {
  clearRuleSetCache,
  filesFromRow,
  kernelGate,
  readDiskRuleFiles,
} from "../src/lib/rules/resolve";
import { ensureShadowBranches } from "../src/lib/shadow/branches";
import { argvHasFlag, assertDestructiveAllowed } from "./lib/db-target-guard";

function flagValue(flag: string, argv: string[] = process.argv): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function printPlan(args: {
  activeId: number;
  candidateId: number | null;
  decision: Exclude<ReturnType<typeof decidePublish>, { action: "noop" }>;
}): void {
  console.log(`ACTIVE RuleVersion ${args.activeId}`);
  console.log(`CANDIDATE ${args.candidateId ?? "(none)"}`);
  if (args.decision.action === "abort") {
    console.log("rebase decision: conflict");
    console.log(`  publish paths:    ${args.decision.publishChangedPaths.join(", ")}`);
    console.log(`  candidate paths:  ${args.decision.candidateChangedPaths.join(", ")}`);
    return;
  }
  console.log(`rebase decision: ${args.decision.rebase ? "rebase" : "none"}`);
  console.log(`  changed files:  ${args.decision.changedFiles.join(", ") || "(none)"}`);
  console.log(`  changed paths:  ${args.decision.publishChangedPaths.join(", ") || "(none)"}`);
  console.log(`  diff lines:     ${args.decision.diffLineCount}`);
}

async function main() {
  const dryRun = argvHasFlag("--dry-run");
  const summary = flagValue("--summary") ?? DEFAULT_PUBLISH_SUMMARY;

  if (!dryRun) {
    assertDestructiveAllowed("publish on-disk /prompts as a new ACTIVE RuleVersion");
    if (!argvHasFlag("--confirm-destructive")) {
      throw new Error(
        "Pass --confirm-destructive to publish (or --dry-run to print the plan).",
      );
    }
  }

  const diskFiles = await readDiskRuleFiles();
  const [active, candidate] = await Promise.all([
    prisma.ruleVersion.findFirst({ where: { status: "ACTIVE" }, orderBy: { id: "desc" } }),
    prisma.ruleVersion.findFirst({ where: { status: "CANDIDATE" }, orderBy: { id: "desc" } }),
  ]);
  if (!active) throw new Error("No ACTIVE RuleVersion — nothing to publish onto.");

  const activeFiles = filesFromRow(active.files);
  const candidatePaths = candidate ? changedPathsOf(candidate) : null;
  const decision = decidePublish({
    diskFiles,
    activeFiles,
    candidateChangedPaths: candidatePaths,
  });

  if (decision.action === "noop") {
    console.log(`nothing to publish — disk matches ACTIVE RuleVersion ${active.id}`);
    return;
  }

  printPlan({
    activeId: active.id,
    candidateId: candidate?.id ?? null,
    decision,
  });

  if (decision.action === "abort") {
    console.error(
      "\nABORT: this publish touches a section the in-flight CANDIDATE also rewrote.",
    );
    console.error("The candidate was left untouched. Resolve the overlap by hand.");
    process.exitCode = 1;
    return;
  }

  const gate = kernelGate(diskFiles);
  if (!gate.ok) {
    console.error("\nABORT: kernelGate failed on disk /prompts:");
    for (const v of gate.violations) {
      console.error(`  ${v.code} ${v.clauseId}${v.file ? ` (${v.file}:${v.line ?? "?"})` : ""}`);
    }
    process.exitCode = 1;
    return;
  }
  const forbidden = scanForbiddenPatterns(diskFiles);
  if (forbidden.length > 0) {
    console.error("\nABORT: forbidden pattern on disk /prompts:");
    for (const hit of forbidden) {
      console.error(`  ${hit.pattern} (${hit.file}:${hit.line})`);
    }
    process.exitCode = 1;
    return;
  }

  let rebasedClone: ReturnType<typeof buildRebasedCandidateClone> | null = null;
  if (candidate) {
    rebasedClone = buildRebasedCandidateClone({
      newActiveId: 0, // stamped after the new ACTIVE row exists
      newActiveFiles: diskFiles,
      candidateFiles: filesFromRow(candidate.files),
      candidateChangedPaths: candidatePaths ?? [],
      changeSummary: candidate.changeSummary,
    });
    const rebaseGate = kernelGate(rebasedClone.files);
    const rebaseForbidden = scanForbiddenPatterns(rebasedClone.files);
    if (!rebaseGate.ok || rebaseForbidden.length > 0) {
      console.error(
        "\nABORT: rebased CANDIDATE fails kernel / forbidden-pattern gate. Candidate left untouched.",
      );
      process.exitCode = 1;
      return;
    }
  }

  if (dryRun) {
    console.log("\ndry-run: no writes.");
    return;
  }

  const now = new Date();
  const published = buildPublishedActivePayload({
    parentId: active.id,
    files: diskFiles,
    changeSummary: summary,
    changedPaths: decision.publishChangedPaths,
  });

  const tx = await prisma.$transaction(async (client) => {
    const retired = await client.ruleVersion.updateMany({
      where: { id: active.id, status: "ACTIVE" },
      data: { status: "RETIRED", retiredAt: now },
    });
    if (retired.count !== 1) throw new Error("rule_version_race");

    const created = await client.ruleVersion.create({
      data: {
        status: published.status,
        lane: published.lane,
        actor: published.actor,
        parentId: published.parentId,
        files: published.files as unknown as Prisma.InputJsonValue,
        fileShas: published.fileShas as unknown as Prisma.InputJsonValue,
        limits: active.limits as Prisma.InputJsonValue,
        changeSummary: published.changeSummary,
        changedPaths: published.changedPaths as unknown as Prisma.InputJsonValue,
        // Format-only publish: inherit the incumbent's evidence window so the live
        // comparison series is unbroken.
        evidenceCutoff: active.evidenceCutoff,
        reasoningPattern: null,
        successMetric: null,
        counterCase: null,
        direction: published.direction,
        scope: active.scope,
        activatedAt: now,
      },
      select: { id: true },
    });

    let newCandidateId: number | null = null;
    if (candidate && rebasedClone) {
      const killed = await client.ruleVersion.updateMany({
        where: { id: candidate.id, status: "CANDIDATE" },
        data: { status: "KILLED", retiredAt: now },
      });
      if (killed.count !== 1) throw new Error("rule_version_race");

      const clone = buildRebasedCandidateClone({
        newActiveId: created.id,
        newActiveFiles: diskFiles,
        candidateFiles: filesFromRow(candidate.files),
        candidateChangedPaths: candidatePaths ?? [],
        changeSummary: candidate.changeSummary,
      });
      const newCandidate = await client.ruleVersion.create({
        data: {
          status: "CANDIDATE",
          lane: candidate.lane,
          actor: candidate.actor,
          parentId: clone.parentId,
          files: clone.files as unknown as Prisma.InputJsonValue,
          fileShas: clone.fileShas as unknown as Prisma.InputJsonValue,
          limits: candidate.limits as Prisma.InputJsonValue,
          changeSummary: clone.changeSummary,
          changedPaths: candidate.changedPaths as Prisma.InputJsonValue,
          evidenceCutoff: candidate.evidenceCutoff,
          reasoningPattern: candidate.reasoningPattern,
          successMetric: candidate.successMetric,
          counterCase: candidate.counterCase,
          direction: candidate.direction,
          scope: candidate.scope,
        },
        select: { id: true },
      });
      newCandidateId = newCandidate.id;

      await appendEvolutionEvent(
        {
          kind: "EARLY_KILL",
          ruleVersionId: candidate.id,
          actor: "HUMAN",
          detail: earlyKillPublishDetail({
            publishChangedPaths: decision.publishChangedPaths,
            candidateChangedPaths: candidatePaths ?? [],
            newActiveId: created.id,
            newCandidateId,
          }) as Prisma.InputJsonValue,
        },
        client,
      );
    }

    // TODO: no EvolutionEventKind fits a human publish (no HUMAN_PUBLISH). GAPFIX +
    // actor HUMAN is the closest existing kind — escalate if a dedicated kind is wanted.
    const rebasedCandidate =
      candidate && newCandidateId !== null
        ? { from: candidate.id, to: newCandidateId }
        : null;
    await appendEvolutionEvent(
      {
        kind: "GAPFIX",
        ruleVersionId: created.id,
        actor: "HUMAN",
        detail: publishGapfixDetail({
          fromVersionId: active.id,
          toVersionId: created.id,
          rebasedCandidate,
        }) as Prisma.InputJsonValue,
      },
      client,
    );

    return { newActiveId: created.id, newCandidateId };
  });

  clearRuleSetCache();
  if (tx.newCandidateId !== null) {
    // Pointer only — do not reset the paper book; the cutover script owns that.
    await prisma.shadowBranch.updateMany({
      where: { branch: "CANDIDATE" },
      data: { ruleVersionId: tx.newCandidateId },
    });
  }
  // LIVE re-points at the new ACTIVE; a legitimate CANDIDATE pointer is left alone.
  await ensureShadowBranches();

  // Soft-fails / no-ops when RULES_MIRROR_* is unset — never fails the publish.
  const mirror = await mirrorRuleVersion(tx.newActiveId);
  await appendEvolutionEvent({
    kind: "MIRROR",
    ruleVersionId: tx.newActiveId,
    actor: "HUMAN",
    detail: { via: "publish_rule_version", ...mirror } as Prisma.InputJsonValue,
  });

  console.log(`\nPublished ACTIVE RuleVersion ${tx.newActiveId} (parent ${active.id}).`);
  if (tx.newCandidateId !== null && candidate) {
    console.log(`Rebased CANDIDATE ${candidate.id} → ${tx.newCandidateId}.`);
  } else {
    console.log("No in-flight CANDIDATE to rebase.");
  }
  console.log("Next: npx tsx scripts/verify-rule-parity.ts");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
