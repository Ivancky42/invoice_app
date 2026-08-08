/**
 * Verify counterfactual credits have the SIGN the fitness function depends on:
 * names that FELL after being refused must show a positive credit, names that ROSE must
 * show a negative one (the debit side is what stops "avoid everything" scoring well).
 *
 * Exits 1 on any assertion failure, or when a requested ticker has no resolved rows.
 *
 * Usage:
 *   npx tsx scripts/verify-counterfactuals.ts --tickers MU,MP,IONQ,LUNR,ASTS
 *   npx tsx scripts/verify-counterfactuals.ts --tickers MU,MP --risen NVDA,AVGO
 *   npx tsx scripts/verify-counterfactuals.ts --tickers MU --branch CANDIDATE
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";

function argValue(flag: string): string | null {
  const at = process.argv.indexOf(flag);
  if (at === -1) return null;
  return process.argv[at + 1] ?? null;
}

function tickerList(raw: string | null): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => t.length > 0),
    ),
  ];
}

const fallen = tickerList(argValue("--tickers"));
const risen = tickerList(argValue("--risen"));
const branchArg = (argValue("--branch") ?? "LIVE").toUpperCase();

if (fallen.length === 0 && risen.length === 0) {
  console.error("Pass --tickers A,B,C (expected positive credit) and/or --risen X,Y");
  process.exit(1);
}
if (branchArg !== "LIVE" && branchArg !== "CANDIDATE") {
  console.error(`--branch must be LIVE or CANDIDATE (got ${branchArg})`);
  process.exit(1);
}
const branch = branchArg as "LIVE" | "CANDIDATE";

const url = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: normalizePgConnectionString(url) });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type Expectation = "POSITIVE" | "NEGATIVE";

async function checkTickers(
  branchId: string,
  tickers: string[],
  expect: Expectation,
): Promise<number> {
  let failures = 0;

  for (const ticker of tickers) {
    const rows = await prisma.counterfactual.findMany({
      where: { branchId, ticker, status: "RESOLVED" },
      orderBy: { decisionSession: "asc" },
      select: {
        decisionSession: true,
        decisionType: true,
        permittedSize: true,
        horizonReturn: true,
        credit: true,
      },
    });

    if (rows.length === 0) {
      console.error(`${ticker}: no RESOLVED counterfactual rows`);
      failures += 1;
      continue;
    }

    for (const row of rows) {
      const credit = Number(row.credit ?? 0);
      const ok = expect === "POSITIVE" ? credit > 0 : credit < 0;
      console.log(
        JSON.stringify({
          ticker,
          decisionSession: row.decisionSession.toISOString().slice(0, 10),
          decisionType: row.decisionType,
          permittedSize: Number(row.permittedSize),
          horizonReturn: Number(row.horizonReturn ?? 0),
          credit,
          expect,
          ok,
        }),
      );
      if (!ok) failures += 1;
    }
  }

  return failures;
}

async function main() {
  const branchRow = await prisma.shadowBranch.findUnique({
    where: { branch },
    select: { id: true },
  });
  if (!branchRow) {
    console.error(`No ShadowBranch row for ${branch}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Branch ${branch}`);
  const failures =
    (await checkTickers(branchRow.id, fallen, "POSITIVE")) +
    (await checkTickers(branchRow.id, risen, "NEGATIVE"));

  if (failures > 0) {
    console.error(`${failures} counterfactual assertion(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("All counterfactual credits carry the expected sign.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
