/**
 * Seed RuleVersion id 1 (ACTIVE, HUMAN) from the committed /prompts files + Config.LIMITS.
 * No-op when any RuleVersion already exists — never clobbers stored rulesets.
 *
 * Usage: npx tsx scripts/seed-rule-version.ts
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";
import { validateKernel } from "../src/lib/rules/kernel";
import { DEFAULT_LIMITS } from "../src/lib/stocks/config";

const RULE_FILE_NAMES = ["_shared.md", "daily.md", "weekly.md", "earnings.md", "monthly.md"];

const url = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: normalizePgConnectionString(url) });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function main() {
  const existing = await prisma.ruleVersion.count();
  if (existing > 0) {
    const active = await prisma.ruleVersion.findFirst({ where: { status: "ACTIVE" } });
    console.log(`RuleVersion rows already exist (${existing}); ACTIVE = ${active?.id ?? "none"}.`);
    return;
  }

  const dir = path.join(process.cwd(), "prompts");
  const files: Record<string, string> = {};
  for (const name of RULE_FILE_NAMES) {
    files[name] = await fs.readFile(path.join(dir, name), "utf8");
  }
  // Never write an ACTIVE version whose kernel does not validate.
  const violations = validateKernel(files);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`  ${v.code} ${v.clauseId}${v.file ? ` (${v.file}:${v.line ?? "?"})` : ""}`);
    }
    throw new Error(`kernel validation failed — ${violations.length} violation(s), nothing written`);
  }

  const fileShas = Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, sha256Hex(text)]),
  );

  const limitsRow = await prisma.config.findUnique({ where: { key: "LIMITS" } });
  const limits =
    limitsRow?.value && typeof limitsRow.value === "object" && !Array.isArray(limitsRow.value)
      ? { ...DEFAULT_LIMITS, ...(limitsRow.value as Record<string, unknown>) }
      : DEFAULT_LIMITS;
  if (!limitsRow) console.warn("WARNING: Config.LIMITS missing — seeding DEFAULT_LIMITS");

  const now = new Date();
  const created = await prisma.ruleVersion.create({
    data: {
      status: "ACTIVE",
      actor: "HUMAN",
      files,
      fileShas,
      limits: limits as object,
      changeSummary: "Initial version seeded from committed /prompts",
      evidenceCutoff: now,
      activatedAt: now,
    },
  });

  console.log(`Created RuleVersion ${created.id} (ACTIVE):`);
  for (const [name, sha] of Object.entries(fileShas)) console.log(`  ${name}  ${sha}`);
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
