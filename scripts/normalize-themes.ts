/**
 * Backfill Theme enum columns from *Raw sector/theme strings.
 *
 * Dry-run by default. Pass --apply to write.
 * Unmatched distinct values are printed prominently; never defaulted / invented.
 * Pass --strict to exit 1 when any unmatched non-empty raw value exists.
 *
 * Usage: npx tsx scripts/normalize-themes.ts [--apply] [--strict]
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePgConnectionString } from "../src/lib/pg-connection-string";
import { normalizeKey, normalizeTheme } from "../src/lib/stocks/normalizeStatus";

const apply = process.argv.includes("--apply");
const strict = process.argv.includes("--strict");

const pool = new Pool({
  connectionString: normalizePgConnectionString(process.env.DATABASE_URL!),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type Unmatched = Map<string, Set<string>>;

function noteUnmatched(bag: Unmatched, field: string, raw: string) {
  if (!bag.has(field)) bag.set(field, new Set());
  bag.get(field)!.add(raw);
}

/** Dumping-ground labels: leave theme null, still report. */
function isDumpingGround(raw: string): boolean {
  const key = normalizeKey(raw);
  return key === "other" || key === "misc" || key === "miscellaneous" || key === "n/a";
}

async function main() {
  const unmatched: Unmatched = new Map();
  let wouldUpdate = 0;
  let updated = 0;

  console.log(apply ? "APPLY mode — writing theme columns\n" : "DRY-RUN — no writes\n");

  // --- Portfolio ---
  const portfolios = await prisma.portfolio.findMany();
  for (const row of portfolios) {
    const raw = row.sectorTagRaw;
    const theme = normalizeTheme(raw);
    if (raw && !theme && !isDumpingGround(raw)) {
      noteUnmatched(unmatched, "Portfolio.sectorTagRaw", raw);
    } else if (raw && isDumpingGround(raw)) {
      noteUnmatched(unmatched, "Portfolio.sectorTagRaw (dumping-ground → null)", raw);
    }
    if (row.theme === theme) continue;
    wouldUpdate++;
    if (apply) {
      await prisma.portfolio.update({ where: { id: row.id }, data: { theme } });
      updated++;
    }
  }

  // --- Watchlist ---
  const watchlist = await prisma.watchlist.findMany();
  for (const row of watchlist) {
    const themeRaw = row.themeRaw;
    const sectorRaw = row.sectorRaw;
    const theme = normalizeTheme(themeRaw) ?? normalizeTheme(sectorRaw);
    for (const [field, raw] of [
      ["Watchlist.themeRaw", themeRaw],
      ["Watchlist.sectorRaw", sectorRaw],
    ] as const) {
      if (!raw || normalizeTheme(raw)) continue;
      noteUnmatched(
        unmatched,
        isDumpingGround(raw) ? `${field} (dumping-ground → null)` : field,
        raw,
      );
    }
    if (row.theme === theme) continue;
    wouldUpdate++;
    if (apply) {
      await prisma.watchlist.update({ where: { id: row.id }, data: { theme } });
      updated++;
    }
  }

  // --- Trend ---
  const trends = await prisma.trend.findMany();
  for (const row of trends) {
    const raw = row.themeSectorRaw;
    const theme = normalizeTheme(raw);
    if (raw && !theme) {
      noteUnmatched(
        unmatched,
        isDumpingGround(raw)
          ? "Trend.themeSectorRaw (dumping-ground → null)"
          : "Trend.themeSectorRaw",
        raw,
      );
    }
    if (row.theme === theme) continue;
    wouldUpdate++;
    if (apply) {
      await prisma.trend.update({ where: { id: row.id }, data: { theme } });
      updated++;
    }
  }

  // --- Idea ---
  const ideas = await prisma.idea.findMany();
  for (const row of ideas) {
    const raw = row.themeRaw;
    const theme =
      normalizeTheme(raw) ??
      normalizeTheme(row.stockSector) ??
      null;
    if (raw && !normalizeTheme(raw) && !isDumpingGround(raw) && !theme) {
      noteUnmatched(unmatched, "Idea.themeRaw", raw);
    } else if (!theme && row.stockSector && !normalizeTheme(row.stockSector)) {
      noteUnmatched(unmatched, "Idea.stockSector (theme infer)", row.stockSector);
    }
    if (row.theme === theme) continue;
    wouldUpdate++;
    if (apply) {
      await prisma.idea.update({ where: { id: row.id }, data: { theme } });
      updated++;
    }
  }

  console.log(apply ? `Updated ${updated} rows.` : `Would update ${wouldUpdate} rows.`);
  console.log("\n========================================");
  console.log("=== UNMATCHED THEME VALUES (raw) ===");
  console.log("========================================");
  if (unmatched.size === 0) {
    console.log("(none)");
  } else {
    for (const [field, vals] of [...unmatched.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`\n${field}:`);
      for (const v of [...vals].sort()) console.log(`  ${JSON.stringify(v)}`);
    }
    console.log("\n(Left theme=null; raw retained. Do not invent buckets.)");
  }

  if (strict && unmatched.size > 0) {
    console.error("\n--strict: unmatched themes present; exiting 1");
    process.exitCode = 1;
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
