/**
 * One-time cutover: clone the LIVE paper book into CANDIDATE so both books start
 * identical and only the rules differ. Pre-cutover CANDIDATE DecisionReviews fall
 * outside the new `resetAt` automatically.
 *
 * Usage:
 *   npx tsx scripts/align-paper-books.ts --confirm-destructive
 *   npx tsx scripts/align-paper-books.ts --confirm-destructive --allow-promote-on
 *
 * Refuses to run while EVOLUTION_PROMOTE is on unless `--allow-promote-on` is given.
 * Remote/prod DATABASE_URL requires `--confirm-destructive`. Never commit prod URLs.
 */
import "dotenv/config";
import type { Branch } from "../src/generated/prisma/client";
import { isEvolutionPromotePaused } from "../src/lib/evolution/evaluate";
import { prisma } from "../src/lib/prisma";
import {
  cloneBranchBook,
  cloneRestartNav,
  ensureShadowBranches,
} from "../src/lib/shadow/branches";
import { decToNum } from "../src/lib/stocks/format";
import { assertDestructiveAllowed } from "./lib/db-target-guard";

const allowPromoteOn = process.argv.includes("--allow-promote-on");

async function printBook(label: string, branch: Branch): Promise<void> {
  const row = await prisma.shadowBranch.findUnique({
    where: { branch },
    select: {
      id: true,
      cash: true,
      startNav: true,
      highWaterNav: true,
      resetAt: true,
      ruleVersionId: true,
    },
  });
  if (!row) {
    console.log(`${label} ${branch}: (no ShadowBranch row)`);
    return;
  }
  const positions = await prisma.shadowPosition.findMany({
    where: { branchId: row.id, closedAt: null },
    select: { ticker: true, shares: true, avgCost: true, lastMark: true },
    orderBy: { ticker: "asc" },
  });
  const cash = decToNum(row.cash) ?? 0;
  const nav = cloneRestartNav(
    positions.map((p) => ({
      shares: decToNum(p.shares) ?? 0,
      lastMark: decToNum(p.lastMark),
      avgCost: decToNum(p.avgCost) ?? 0,
    })),
    cash,
  );
  const names = positions
    .map((p) => `${p.ticker}:${decToNum(p.shares)}@${decToNum(p.lastMark) ?? decToNum(p.avgCost)}`)
    .join(" ") || "(flat)";
  console.log(
    `${label} ${branch}: cash=${cash} nav=${nav}` +
      ` startNav=${decToNum(row.startNav)} highWater=${decToNum(row.highWaterNav)}` +
      ` ruleVersionId=${row.ruleVersionId} resetAt=${row.resetAt.toISOString()}`,
  );
  console.log(`  positions: ${names}`);
}

async function main() {
  assertDestructiveAllowed("clone LIVE paper book into CANDIDATE");

  if (!(await isEvolutionPromotePaused()) && !allowPromoteOn) {
    throw new Error(
      "EVOLUTION_PROMOTE is on; refuse to clone while promotion can fire. " +
        "Pause EVOLUTION_PROMOTE or re-run with --allow-promote-on.",
    );
  }

  await ensureShadowBranches();
  const candidate = await prisma.shadowBranch.findUnique({
    where: { branch: "CANDIDATE" },
    select: { ruleVersionId: true },
  });
  if (!candidate) {
    throw new Error("CANDIDATE ShadowBranch is missing after ensureShadowBranches.");
  }

  console.log(`\nCloning LIVE → CANDIDATE under ruleVersionId=${candidate.ruleVersionId}\n`);
  await printBook("BEFORE", "LIVE");
  await printBook("BEFORE", "CANDIDATE");

  await cloneBranchBook("LIVE", "CANDIDATE", candidate.ruleVersionId);

  console.log("");
  await printBook("AFTER", "LIVE");
  await printBook("AFTER", "CANDIDATE");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
