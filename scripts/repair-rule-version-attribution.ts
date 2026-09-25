/**
 * Restore DecisionReview.ruleVersionId to the ruleset each decision was MADE under.
 *
 * Before the replay fix (src/lib/agent/decisionReviewReplay.ts) every outcome-review
 * update re-stamped ruleVersionId with the ruleset running at review time, so scoring an
 * old decision re-attributed it (e.g. a 2026-08-09 CANDIDATE WAIT now reads v8). This
 * recomputes the expected id from the row's createdAt and the RuleVersion timeline and
 * reports / fixes rows that disagree. Rows created before any ruleset existed expect null.
 *
 * `rulesVersion` (the caller-stamped deploy sha) was overwritten the same way but has no
 * recoverable history, so it is reported, not changed.
 *
 * Usage:
 *   npx tsx scripts/repair-rule-version-attribution.ts            # dry run (default)
 *   npx tsx scripts/repair-rule-version-attribution.ts --confirm-write
 *
 * Refuses to run once any PROMOTE event exists: revert series are not modelled.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { assertWriteAllowed } from "./lib/db-target-guard";
import { branchVersionAt } from "./lib/ruleVersionTimeline";

const write = process.argv.includes("--confirm-write");

async function main() {
  const promotions = await prisma.evolutionEvent.count({ where: { kind: "PROMOTE" } });
  if (promotions > 0) {
    throw new Error(
      `${promotions} PROMOTE event(s) exist — the timeline would misattribute revert series. Extend ruleVersionTimeline first.`,
    );
  }

  const versions = await prisma.ruleVersion.findMany({
    select: { id: true, lane: true, createdAt: true, activatedAt: true, retiredAt: true },
  });
  const rows = await prisma.decisionReview.findMany({
    select: {
      id: true,
      ticker: true,
      branch: true,
      book: true,
      decisionType: true,
      createdAt: true,
      updatedAt: true,
      ruleVersionId: true,
      rulesVersion: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const fixes = rows
    .map((r) => ({ ...r, expected: branchVersionAt(versions, r.branch, r.createdAt) }))
    .filter((r) => r.ruleVersionId !== r.expected);

  console.log(`Scanned ${rows.length} decision reviews; ${fixes.length} misattributed.\n`);
  for (const f of fixes) {
    console.log(
      [
        f.createdAt.toISOString().slice(0, 16),
        `${f.branch}/${f.book}`.padEnd(15),
        (f.ticker ?? "-").padEnd(6),
        (f.decisionType ?? "-").padEnd(20),
        `v${f.ruleVersionId ?? "null"} -> v${f.expected ?? "null"}`,
        `(updated ${f.updatedAt.toISOString().slice(0, 10)}, sha ${f.rulesVersion ?? "-"})`,
      ].join("  "),
    );
  }

  if (!write) {
    console.log("\nDry run — nothing written. Re-run with --confirm-write to apply.");
    return;
  }
  assertWriteAllowed("repair DecisionReview.ruleVersionId attribution");
  await prisma.$transaction(
    fixes.map((f) =>
      prisma.decisionReview.update({
        where: { id: f.id },
        data: { ruleVersionId: f.expected },
      }),
    ),
  );
  console.log(`\nUpdated ${fixes.length} rows.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
