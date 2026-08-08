/**
 * Apply raw SQL constraints Prisma's schema language cannot express.
 * `prisma db push` (local dev) silently skips these, so chain this after it.
 * Idempotent — safe to run repeatedly.
 *
 * Usage: npx tsx scripts/apply-raw-constraints.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";

/** Each entry must be idempotent on its own. */
const STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    // Null lanes (human candidates) must collide too, and SQL NULLs are distinct — so the
    // index keys off a CASE that maps null onto 'NONE'. `COALESCE("lane"::text, 'NONE')`
    // is rejected: the enum→text cast is only STABLE. Extend the CASE if RuleLane grows.
    // DROP + CREATE inside one DO block: re-running converges an older ON ("lane")
    // definition to this one atomically (a bare CREATE IF NOT EXISTS would keep the old).
    label: "RuleVersion_one_candidate_per_lane",
    sql: `DO $$ BEGIN
      DROP INDEX IF EXISTS "RuleVersion_one_candidate_per_lane";
      CREATE UNIQUE INDEX "RuleVersion_one_candidate_per_lane" ON "RuleVersion"
        ((CASE WHEN "lane" IS NULL THEN 'NONE' WHEN "lane" = 'FAST' THEN 'FAST' ELSE 'SLOW' END))
        WHERE "status" = 'CANDIDATE';
    END $$`,
  },
  {
    label: "RuleVersion_one_active",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "RuleVersion_one_active" ON "RuleVersion"((1)) WHERE "status" = 'ACTIVE'`,
  },
  {
    // A branch's paper book holds at most one OPEN position per ticker; closed rows are
    // history and may repeat, so the uniqueness has to be partial on closedAt IS NULL.
    label: "ShadowPosition_open_unique",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "ShadowPosition_open_unique" ON "ShadowPosition"("branchId","ticker") WHERE "closedAt" IS NULL`,
  },
  {
    // The evolution audit log is append-only at the DATABASE level: DO INSTEAD NOTHING
    // turns UPDATE/DELETE into silent no-ops for every role, so no agent, migration or
    // psql session can rewrite history. `prisma db push` never emits RULEs, hence here.
    label: "EvolutionEvent_no_delete",
    sql: `CREATE OR REPLACE RULE "EvolutionEvent_no_delete" AS ON DELETE TO "EvolutionEvent" DO INSTEAD NOTHING`,
  },
  {
    label: "EvolutionEvent_no_update",
    sql: `CREATE OR REPLACE RULE "EvolutionEvent_no_update" AS ON UPDATE TO "EvolutionEvent" DO INSTEAD NOTHING`,
  },
];

const url = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: normalizePgConnectionString(url) });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  for (const { label, sql } of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
    console.log(`  applied ${label}`);
  }
  console.log("Raw constraints applied.");
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
