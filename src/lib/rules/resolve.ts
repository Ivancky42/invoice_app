/**
 * Branch-aware ruleset resolution.
 *
 * LIVE runs the ACTIVE RuleVersion; CANDIDATE runs the candidate when one exists and
 * falls back to ACTIVE otherwise. Resolution must never throw: a DB blip degrades to the
 * on-disk `/prompts` files + DEFAULT_LIMITS rather than stopping the live routine.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Branch } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { validateKernel, type KernelViolation } from "@/lib/rules/kernel";
import {
  DEFAULT_LIMITS,
  getLimits,
  parseLimits,
  type LimitsConfig,
} from "@/lib/stocks/config";

/** Prompt file names stored in RuleVersion.files (keys include the .md suffix). */
export const RULE_FILE_NAMES = [
  "_shared.md",
  "daily.md",
  "weekly.md",
  "earnings.md",
  "monthly.md",
] as const;

export type RuleSet = {
  /** RuleVersion.id, or 0 when degraded to disk. */
  versionId: number;
  files: Record<string, string>;
  limits: LimitsConfig;
  /** True when the DB could not be consulted and disk/defaults were used. */
  degraded: boolean;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<Branch, { at: number; value: RuleSet }>();

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Read the five committed prompt files from disk. */
export async function readDiskRuleFiles(): Promise<Record<string, string>> {
  const dir = path.join(process.cwd(), "prompts");
  const entries = await Promise.all(
    RULE_FILE_NAMES.map(
      async (name) => [name, await fs.readFile(path.join(dir, name), "utf8")] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/** Coerce a RuleVersion.files / fileShas JSON column into a string map. */
export function filesFromRow(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === "string") out[key] = text;
  }
  return out;
}

/**
 * Candidate files overlaid on the ACTIVE ruleset.
 *
 * A candidate is expected to carry the full corpus; this merge is defence-in-depth so a
 * file the candidate lacks comes from the live ruleset rather than falling through to
 * disk per file, which would silently mix candidate and on-disk prose. Empty candidate
 * entries are treated as absent for the same reason. Disk remains the degraded-path only.
 */
export function mergeCandidateFiles(
  activeFiles: Record<string, string>,
  candidateFiles: Record<string, string>,
): Record<string, string> {
  const out = { ...activeFiles };
  for (const [name, text] of Object.entries(candidateFiles)) {
    if (typeof text === "string" && text.length > 0) out[name] = text;
  }
  return out;
}

export type KernelGate = {
  ok: boolean;
  /** Distinct clause ids involved in the violations, sorted. */
  clauseIds: string[];
  violations: KernelViolation[];
};

/**
 * Decide whether a ruleset may be written or served. Pure — the only place that
 * turns kernel violations into a serve/refuse verdict, so it can be unit-tested.
 */
export function kernelGate(files: Record<string, string>): KernelGate {
  const violations = validateKernel(files);
  return {
    ok: violations.length === 0,
    clauseIds: [...new Set(violations.map((v) => v.clauseId))].sort(),
    violations,
  };
}

/**
 * Seed RuleVersion id 1 from the committed prompt files + live LIMITS.
 * No-op when any version already exists — never clobbers stored rulesets.
 * Throws rather than seeding an ACTIVE version whose kernel does not validate.
 */
export async function ensureRuleVersion1(): Promise<void> {
  const existing = await prisma.ruleVersion.count();
  if (existing > 0) return;

  const [files, limits] = await Promise.all([readDiskRuleFiles(), getLimits()]);
  const gate = kernelGate(files);
  if (!gate.ok) {
    throw new Error(`kernel_violation: ${gate.clauseIds.join(", ")}`);
  }
  const fileShas = Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, sha256Hex(text)]),
  );

  try {
    await prisma.ruleVersion.create({
      data: {
        status: "ACTIVE",
        actor: "HUMAN",
        files,
        fileShas,
        limits: limits as unknown as object,
        changeSummary: "Initial version seeded from committed /prompts",
        // Nothing before this instant counts as evidence for any future comparison.
        evidenceCutoff: new Date(),
        activatedAt: new Date(),
      },
    });
  } catch (err) {
    // Concurrent seed: the partial unique index on ACTIVE is the hard backstop.
    const again = await prisma.ruleVersion.count();
    if (again > 0) return;
    throw err;
  }
}

async function loadRuleSet(branch: Branch): Promise<RuleSet> {
  const findActive = () =>
    prisma.ruleVersion.findFirst({ where: { status: "ACTIVE" }, orderBy: { id: "desc" } });

  const [candidate, activeRow] = await Promise.all([
    branch === "CANDIDATE"
      ? prisma.ruleVersion.findFirst({
          where: { status: "CANDIDATE" },
          orderBy: { id: "desc" },
        })
      : null,
    findActive(),
  ]);

  // Correct null case for CANDIDATE: no candidate exists → run the live ruleset.
  let active = activeRow;
  if (!candidate && !active) {
    await ensureRuleVersion1();
    active = await findActive();
  }

  const row = candidate ?? active;
  if (!row) throw new Error("no_rule_version");

  const files =
    candidate && active
      ? mergeCandidateFiles(filesFromRow(active.files), filesFromRow(candidate.files))
      : filesFromRow(row.files);

  return {
    versionId: row.id,
    files,
    limits: parseLimits(row.limits) ?? DEFAULT_LIMITS,
    degraded: false,
  };
}

async function diskRuleSet(): Promise<RuleSet> {
  return {
    versionId: 0,
    files: await readDiskRuleFiles(),
    limits: DEFAULT_LIMITS,
    degraded: true,
  };
}

/**
 * Resolve the ruleset for a branch. Cached 60s per branch. Never throws — on any DB
 * failure it returns the on-disk prompts with `degraded: true`.
 *
 * The DB is not trusted to be kernel-intact: a stored ruleset that fails
 * {@link kernelGate} is refused and the committed on-disk files are served instead.
 */
export async function getRuleSet(branch: Branch): Promise<RuleSet> {
  const hit = cache.get(branch);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  try {
    const value = await loadRuleSet(branch);
    const gate = kernelGate(value.files);
    if (!gate.ok) {
      console.error(
        `[rules getRuleSet] kernel violation in ${branch} rule version ${value.versionId}`,
        `clauses: ${gate.clauseIds.join(", ")}`,
        "— serving on-disk ruleset (degraded)",
      );
      const fallback = await diskRuleSet();
      // Cached like a healthy result: the row cannot repair itself within the TTL and
      // the validation (not the query) is what we are amortising.
      cache.set(branch, { at: Date.now(), value: fallback });
      return fallback;
    }
    // Caching the validated value is what makes validation once-per-TTL.
    cache.set(branch, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error("[rules getRuleSet]", branch, err instanceof Error ? err.message : err);
    try {
      // Degraded results are not cached — recover as soon as the DB is back.
      return await diskRuleSet();
    } catch {
      return { versionId: 0, files: {}, limits: DEFAULT_LIMITS, degraded: true };
    }
  }
}

/** Drop the resolution cache (tests / after promotion). */
export function clearRuleSetCache(): void {
  cache.clear();
}
