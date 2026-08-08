/**
 * Verify the ACTIVE RuleVersion's stored prompt text matches the committed /prompts files.
 * Exits 1 on any mismatch (or when no ACTIVE version exists).
 *
 * Usage: npx tsx scripts/verify-rule-parity.ts
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";

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
  const active = await prisma.ruleVersion.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { id: "desc" },
  });
  if (!active) {
    console.error("No ACTIVE RuleVersion — run scripts/seed-rule-version.ts");
    process.exitCode = 1;
    return;
  }

  const dbFiles =
    active.files && typeof active.files === "object" && !Array.isArray(active.files)
      ? (active.files as Record<string, unknown>)
      : {};

  const dir = path.join(process.cwd(), "prompts");
  let mismatches = 0;
  console.log(`ACTIVE RuleVersion ${active.id}`);

  for (const file of RULE_FILE_NAMES) {
    const dbText = typeof dbFiles[file] === "string" ? (dbFiles[file] as string) : null;
    let diskText: string | null = null;
    try {
      diskText = await fs.readFile(path.join(dir, file), "utf8");
    } catch {
      diskText = null;
    }
    const dbSha = dbText === null ? null : sha256Hex(dbText);
    const diskSha = diskText === null ? null : sha256Hex(diskText);
    const identical = dbSha !== null && dbSha === diskSha;
    if (!identical) mismatches += 1;
    console.log(JSON.stringify({ file, dbSha, diskSha, identical }));
  }

  if (mismatches > 0) {
    console.error(`${mismatches} file(s) differ between DB and disk`);
    process.exitCode = 1;
    return;
  }
  console.log("All files identical.");
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
