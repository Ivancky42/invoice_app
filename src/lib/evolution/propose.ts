/**
 * `propose_rule_change`: the agent's only route to a new candidate ruleset.
 *
 * The order of gates is the whole design. Cheap structural checks first, then the KERNEL
 * (which can never be traded away), then the drift rails on individual numbers, then the
 * evidence bar, and only then a row. Every refusal is APPENDED to the evolution log with a
 * machine-readable code — a rejected proposal is evidence too.
 *
 * The agent does NOT choose its lane. A supplied `lane` is stripped and recorded as
 * `laneClaimIgnored`: FAST (a 10-session promotion horizon) is reserved for changes that
 * move whitelisted NUMBERS and nothing else, and letting the proposer self-certify that
 * would make the fast lane the only lane.
 */
import type { Prisma, RuleLane } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { appendEvolutionEvent } from "@/lib/evolution/log";
import {
  changedLimitsPaths,
  FAST_LANE_PARAMS,
  applyPointer,
  isFastLaneParam,
  limitsParam,
  resolvePointer,
} from "@/lib/evolution/parameters";
import {
  checkEligibility,
  type EligibilityDecisionRow,
  type RetiredVersionRow,
} from "@/lib/evolution/eligibility";
import { retiredReasoningPatterns } from "@/lib/evolution/scoring";
import { driftGuard } from "@/lib/fitness/math";
import { changedLinesInside, diffLines } from "@/lib/rules/diff";
// kernelGate wraps validateKernel; fenceRanges/scanForbiddenPatterns are the other two gates.
import { fenceRanges, scanForbiddenPatterns } from "@/lib/rules/kernel";
import {
  RULE_FILE_NAMES,
  filesFromRow,
  kernelGate,
  sha256Hex,
} from "@/lib/rules/resolve";
import { ensureShadowBranches, resetBranch } from "@/lib/shadow/branches";
import { DEFAULT_LIMITS, parseLimits, type LimitsConfig } from "@/lib/stocks/config";
import { decToNum } from "@/lib/stocks/format";

/** Changed lines a SLOW (prose) proposal may touch in one go. */
export const SLOW_DIFF_BUDGET_LINES = 120;

/**
 * `_shared.md` sections that decide EXPOSURE (sleeves, position sizing, averaging down).
 * Prose here is ACTION scope even though no number moved.
 */
const ACTION_PROSE_SECTIONS = new Set(["6", "7", "8"]);

const SECTION_HEADING_RE = /^##\s+(\d+[a-z]?)\./;

// ---------------------------------------------------------------------------
// Section primitives (shared with gapfix)
// ---------------------------------------------------------------------------

export type SectionSlice = {
  sectionId: string;
  /** 0-based line index of the heading. */
  start: number;
  /** 0-based exclusive end (line index of the next heading, or EOF). */
  end: number;
  text: string;
};

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** Locate a `## N.` section by its number. Null when the file has no such heading. */
export function findSection(fileText: string, sectionId: string): SectionSlice | null {
  const lines = splitLines(fileText);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = SECTION_HEADING_RE.exec(lines[i]);
    if (!m) continue;
    if (start === -1 && m[1] === sectionId) {
      start = i;
      continue;
    }
    if (start !== -1) {
      return { sectionId, start, end: i, text: lines.slice(start, i).join("\n") };
    }
  }
  if (start === -1) return null;
  return { sectionId, start, end: lines.length, text: lines.slice(start).join("\n") };
}

/** Replace one section's text wholesale. Returns null when the section does not exist. */
export function replaceSection(
  fileText: string,
  sectionId: string,
  newText: string,
): string | null {
  const slice = findSection(fileText, sectionId);
  if (!slice) return null;
  const lines = splitLines(fileText);
  const replacement = splitLines(newText.replace(/\s+$/, ""));
  return [...lines.slice(0, slice.start), ...replacement, ...lines.slice(slice.end)].join("\n");
}

/** Every `## N.` heading number present in a file, in order. */
export function sectionIds(fileText: string): string[] {
  const out: string[] = [];
  for (const line of splitLines(fileText)) {
    const m = SECTION_HEADING_RE.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Normalise a caller-supplied prompt file name to one of the five stored keys. */
export function normaliseRuleFile(file: string): string | null {
  const name = file.trim().endsWith(".md") ? file.trim() : `${file.trim()}.md`;
  return (RULE_FILE_NAMES as readonly string[]).includes(name) ? name : null;
}

// ---------------------------------------------------------------------------
// Lane assignment (pure)
// ---------------------------------------------------------------------------

export type LaneAssignment = {
  lane: RuleLane;
  /** The lane the caller asked for, when it supplied one. Recorded, never honoured. */
  laneClaimIgnored: string | null;
};

/**
 * Server-side lane assignment. FAST requires BOTH: not one prose line moved anywhere in
 * the corpus, and every changed limits pointer is on the FAST whitelist. Anything else —
 * including a proposal that changes nothing — is SLOW, which carries the longer evidence
 * horizon.
 */
export function assignLane(args: {
  proseLinesChanged: number;
  limitsPaths: readonly string[];
  laneClaim?: unknown;
}): LaneAssignment {
  const laneClaimIgnored =
    typeof args.laneClaim === "string" && args.laneClaim.trim() !== ""
      ? args.laneClaim.trim()
      : null;
  const fast =
    args.proseLinesChanged === 0 &&
    args.limitsPaths.length > 0 &&
    args.limitsPaths.every(isFastLaneParam);
  return { lane: fast ? "FAST" : "SLOW", laneClaimIgnored };
}

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

export type ProposeHunk = {
  file: string;
  sectionId?: string;
  expectedSectionSha?: string;
  newText: string;
};

export type LimitsChange = { path: string; value: number };

export type ProposeRuleChangeInput = {
  hunks?: ProposeHunk[];
  limitsChanges?: LimitsChange[];
  changeSummary: string;
  reasoningPattern: string;
  successMetric: string;
  counterCase: string;
  worstCase?: string | null;
  evidenceDecisionIds?: string[];
  /** Stripped: the server assigns the lane. Recorded in the event detail only. */
  lane?: string;
};

export type ProposeFailure = {
  ok: false;
  status: number;
  reason: string;
  details?: Record<string, unknown>;
};

export type ProposeSuccess = {
  ok: true;
  ruleVersionId: number;
  lane: RuleLane;
  direction: "TIGHTEN" | "LOOSEN" | "NEUTRAL";
  scope: "DISCOVERY" | "ACTION";
  changedPaths: string[];
  proseLinesChanged: number;
  laneClaimIgnored: string | null;
};

export type ProposeResult = ProposeSuccess | ProposeFailure;

type Reject = (
  kind: "KERNEL_ATTEMPT" | "ELIGIBILITY_REJECT" | "DRIFT_BLOCK",
  status: number,
  reason: string,
  details?: Record<string, unknown>,
) => Promise<ProposeFailure>;

// ---------------------------------------------------------------------------
// Drift context
// ---------------------------------------------------------------------------

type DriftContext = {
  limitsAt90dAgo: LimitsConfig;
  limitsAtV1: LimitsConfig;
  /** path → leading run of LOOSEN directions across the last 3 AGENT versions on it. */
  consecutiveLoosenings: Map<string, number>;
};

async function loadDriftContext(
  paths: readonly string[],
  now: Date,
  fallback: LimitsConfig,
): Promise<DriftContext> {
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
  const [v1, older, agentVersions] = await Promise.all([
    prisma.ruleVersion.findUnique({ where: { id: 1 }, select: { limits: true } }),
    prisma.ruleVersion.findFirst({
      where: { createdAt: { lte: ninetyDaysAgo } },
      orderBy: { id: "desc" },
      select: { limits: true },
    }),
    // One query for every path's loosening history; 20 is generous cover for "last 3 per path".
    prisma.ruleVersion.findMany({
      where: { actor: "AGENT" },
      orderBy: { id: "desc" },
      take: 20,
      select: { changedPaths: true, direction: true },
    }),
  ]);

  const limitsAtV1 = parseLimits(v1?.limits ?? null) ?? fallback;
  const limitsAt90dAgo = parseLimits(older?.limits ?? null) ?? limitsAtV1;

  const consecutiveLoosenings = new Map<string, number>();
  for (const path of paths) {
    const touching = agentVersions
      .filter((v) => Array.isArray(v.changedPaths) && v.changedPaths.includes(`limits:${path}`))
      .slice(0, 3);
    let run = 0;
    for (const v of touching) {
      if (v.direction !== "LOOSEN") break;
      run += 1;
    }
    consecutiveLoosenings.set(path, run);
  }

  return { limitsAt90dAgo, limitsAtV1, consecutiveLoosenings };
}

// ---------------------------------------------------------------------------
// propose
// ---------------------------------------------------------------------------

export async function proposeRuleChange(
  input: ProposeRuleChangeInput,
): Promise<ProposeResult> {
  const now = new Date();
  const hunks = input.hunks ?? [];
  const limitsChanges = input.limitsChanges ?? [];

  if (hunks.length === 0 && limitsChanges.length === 0) {
    return { ok: false, status: 400, reason: "no_changes" };
  }

  const active = await prisma.ruleVersion.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { id: "desc" },
  });
  if (!active) {
    return { ok: false, status: 409, reason: "no_active_rule_version" };
  }

  // SINGLE CHALLENGER, enforced in code across ALL lanes. There is one paper book for the
  // challenger; two live candidates (say a FAST and a SLOW one) would trade the same book,
  // evaluate would only ever see one of them, and a killed candidate's predecessor could
  // inherit its sessions and promote on evidence it never earned. The per-lane partial
  // unique index stays as belt-and-braces — lifting this check would need a second Cowork
  // schedule and a per-lane shadow book first.
  //
  // Only an ACTUAL status-CANDIDATE row blocks. When the current challenger is a RETIRED
  // deposed champion mid-revert-series, the slot is idle capital: a new proposal SUPERSEDES
  // the revert series and simply re-points the branch (the old champion stays RETIRED).
  const inFlight = await prisma.ruleVersion.findFirst({
    where: { status: "CANDIDATE" },
    orderBy: { id: "desc" },
    select: { id: true, lane: true },
  });
  if (inFlight) {
    return {
      ok: false,
      status: 409,
      reason: "candidate_slot_occupied",
      details: {
        candidateId: inFlight.id,
        lane: inFlight.lane,
        message: "a candidate is already under test; only one challenger runs at a time",
      },
    };
  }

  const activeFiles = filesFromRow(active.files);
  const activeLimits = parseLimits(active.limits) ?? DEFAULT_LIMITS;

  // Every rejection is itself an audit row — a refused proposal is evidence.
  const reject: Reject = async (kind, status, reason, details) => {
    await appendEvolutionEvent({
      kind,
      ruleVersionId: active.id,
      actor: "AGENT",
      detail: {
        reason,
        parentId: active.id,
        changeSummary: input.changeSummary,
        reasoningPattern: input.reasoningPattern,
        laneClaimIgnored: typeof input.lane === "string" ? input.lane : null,
        ...(details ?? {}),
      } as Prisma.InputJsonValue,
    });
    return { ok: false, status, reason, details };
  };

  // --- 1. Candidate files -------------------------------------------------
  const candidateFiles = { ...activeFiles };
  const prosePaths: string[] = [];
  for (const hunk of hunks) {
    const file = normaliseRuleFile(hunk.file);
    if (!file) {
      return {
        ok: false,
        status: 400,
        reason: "unknown_rule_file",
        details: { file: hunk.file, allowed: [...RULE_FILE_NAMES] },
      };
    }
    const current = candidateFiles[file] ?? "";

    if (hunk.sectionId) {
      const slice = findSection(current, hunk.sectionId);
      if (!slice) {
        return {
          ok: false,
          status: 404,
          reason: "section_not_found",
          details: { file, sectionId: hunk.sectionId },
        };
      }
      if (hunk.expectedSectionSha) {
        const actualSha = sha256Hex(slice.text);
        if (actualSha !== hunk.expectedSectionSha) {
          // The section moved under the proposer's feet — refuse rather than clobber.
          return {
            ok: false,
            status: 409,
            reason: "section_sha_mismatch",
            details: { file, sectionId: hunk.sectionId, actualSha },
          };
        }
      }
      const next = replaceSection(current, hunk.sectionId, hunk.newText);
      if (next === null) {
        return {
          ok: false,
          status: 404,
          reason: "section_not_found",
          details: { file, sectionId: hunk.sectionId },
        };
      }
      candidateFiles[file] = next;
      prosePaths.push(`prompts:${file.replace(/\.md$/, "")}#${hunk.sectionId}`);
    } else {
      candidateFiles[file] = hunk.newText;
      prosePaths.push(`prompts:${file.replace(/\.md$/, "")}`);
    }
  }

  // --- 2. Candidate limits ------------------------------------------------
  // Registry check FIRST. A pointer with no LIMITS_PARAMS entry has no hard range, no
  // loosening direction and no lane, so it would reach Config.LIMITS on promotion having
  // passed no rail at all. Unknown rails are refused outright, not waved through as SLOW.
  for (const change of limitsChanges) {
    if (!limitsParam(change.path)) {
      return reject("ELIGIBILITY_REJECT", 400, "unknown_limits_path", {
        path: change.path,
        message: "not a registered limits rail (src/lib/evolution/parameters.ts)",
      });
    }
  }

  let candidateLimits: LimitsConfig = activeLimits;
  for (const change of limitsChanges) {
    try {
      candidateLimits = applyPointer(candidateLimits, change.path, change.value);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        reason: "unknown_limits_path",
        details: {
          path: change.path,
          message: err instanceof Error ? err.message : "invalid pointer",
        },
      };
    }
  }
  // Recomputed from the objects, not trusted from input: a no-op "change" must not count.
  const limitsPaths = changedLimitsPaths(
    activeLimits,
    candidateLimits,
    limitsChanges.map((c) => c.path),
  );

  // --- 3. Diff + lane -----------------------------------------------------
  let added = 0;
  let removed = 0;
  const fenceViolations: Array<{ file: string; lines: number[] }> = [];
  const deletedSections: Array<{ file: string; sectionId: string }> = [];
  const activeFences = fenceRanges(activeFiles);
  const candidateFences = fenceRanges(candidateFiles);

  for (const file of RULE_FILE_NAMES) {
    const before = activeFiles[file] ?? "";
    const after = candidateFiles[file] ?? "";
    if (before === after) continue;
    const diff = diffLines(before, after);
    added += diff.added;
    removed += diff.removed;

    const insideBefore = changedLinesInside(activeFences[file] ?? [], diff).a;
    const insideAfter = changedLinesInside(candidateFences[file] ?? [], diff).b;
    if (insideBefore.length > 0 || insideAfter.length > 0) {
      fenceViolations.push({ file, lines: [...insideBefore, ...insideAfter].sort((x, y) => x - y) });
    }

    const beforeIds = new Set(sectionIds(before));
    const afterIds = new Set(sectionIds(after));
    for (const id of beforeIds) {
      if (!afterIds.has(id)) deletedSections.push({ file, sectionId: id });
    }
  }
  const proseLinesChanged = added + removed;
  const { lane, laneClaimIgnored } = assignLane({
    proseLinesChanged,
    limitsPaths,
    laneClaim: input.lane,
  });

  // --- 4. Kernel gates (order is load-bearing) ----------------------------
  const gate = kernelGate(candidateFiles);
  if (!gate.ok) {
    const first = gate.violations[0];
    return reject("KERNEL_ATTEMPT", 409, "kernel_violation", {
      clauseIds: gate.clauseIds,
      file: first?.file ?? null,
      line: first?.line ?? null,
      violations: gate.violations,
    });
  }
  if (fenceViolations.length > 0) {
    const first = fenceViolations[0];
    return reject("KERNEL_ATTEMPT", 409, "kernel_fence_edited", {
      file: first.file,
      line: first.lines[0] ?? null,
      files: fenceViolations,
    });
  }

  const forbidden = scanForbiddenPatterns(candidateFiles);
  if (forbidden.length > 0) {
    const first = forbidden[0];
    return reject("KERNEL_ATTEMPT", 409, "forbidden_pattern", {
      pattern: first.pattern,
      file: first.file,
      line: first.line,
      hits: forbidden,
    });
  }

  if (lane === "SLOW" && proseLinesChanged > SLOW_DIFF_BUDGET_LINES) {
    return reject("KERNEL_ATTEMPT", 400, "diff_budget_exceeded", {
      changedLines: proseLinesChanged,
      budget: SLOW_DIFF_BUDGET_LINES,
    });
  }
  if (lane === "FAST" && proseLinesChanged > 0) {
    // Unreachable by construction (assignLane demotes any prose change to SLOW); kept as a
    // hard assertion so a future edit to assignLane cannot quietly widen the fast lane.
    return reject("KERNEL_ATTEMPT", 500, "lane_invariant_violated", {
      changedLines: proseLinesChanged,
    });
  }

  const summary = input.changeSummary.toLowerCase();
  const unnamedDeletion = deletedSections.find(
    (s) => !summary.includes(`§${s.sectionId}`) && !summary.includes(`section ${s.sectionId}`),
  );
  if (unnamedDeletion) {
    return reject("KERNEL_ATTEMPT", 400, "section_deleted", {
      file: unnamedDeletion.file,
      sectionId: unnamedDeletion.sectionId,
      deleted: deletedSections,
    });
  }

  // --- 5. Drift rails on every moved number -------------------------------
  const drift = await loadDriftContext(limitsPaths, now, activeLimits);
  let loosens = false;
  let tightens = false;
  for (const path of limitsPaths) {
    const proposed = resolvePointer(candidateLimits, path);
    // EVERY registered rail is drift-guarded, FAST and SLOW alike — the lane decides how
    // long the evidence horizon is, never whether the hard range applies.
    const param = limitsParam(path);
    if (!param) {
      // Unreachable: the registry check above already refused unregistered pointers. Kept
      // as a hard assertion so a future edit cannot reopen the bypass.
      return reject("ELIGIBILITY_REJECT", 400, "unknown_limits_path", { path });
    }
    const valueAt90dAgo = safeResolve(drift.limitsAt90dAgo, path, activeLimits);
    const valueAtV1 = safeResolve(drift.limitsAtV1, path, activeLimits);
    const result = driftGuard({
      paramPath: path,
      hardRange: param.hardRange,
      proposed,
      valueAt90dAgo,
      valueAtV1,
      consecutiveLoosenings: drift.consecutiveLoosenings.get(path) ?? 0,
      looseningDirection: param.looseningDirection,
    });
    if (!result.allowed) {
      return reject("DRIFT_BLOCK", 409, "drift_blocked", {
        path,
        code: result.code,
        proposed,
        hardRange: param.hardRange,
        valueAt90dAgo,
        valueAtV1,
        consecutiveLoosenings: drift.consecutiveLoosenings.get(path) ?? 0,
      });
    }
    const current = resolvePointer(activeLimits, path);
    if (param.looseningDirection === "UP" ? proposed > current : proposed < current) {
      loosens = true;
    } else if (proposed !== current) {
      tightens = true;
    }
  }

  const changedPaths = [...prosePaths, ...limitsPaths.map((p) => `limits:${p}`)];

  // --- 6. Evidence bar ----------------------------------------------------
  const eligibility = await runEligibility(input, changedPaths, now, loosens);
  if (!eligibility.ok) {
    return reject("ELIGIBILITY_REJECT", 422, eligibility.code, {
      stats: eligibility.stats,
      ...(eligibility.detail ?? {}),
    });
  }

  // --- 7. Create the candidate -------------------------------------------
  const direction = loosens ? "LOOSEN" : tightens ? "TIGHTEN" : "NEUTRAL";
  const proseIsAction = prosePaths.some((p) => {
    const [, section] = p.split("#");
    return p.startsWith("prompts:_shared") && section && ACTION_PROSE_SECTIONS.has(section);
  });
  const scope = limitsPaths.length > 0 || proseIsAction ? "ACTION" : "DISCOVERY";

  const fileShas = Object.fromEntries(
    Object.entries(candidateFiles).map(([name, text]) => [name, sha256Hex(text)]),
  );

  let created;
  try {
    created = await prisma.ruleVersion.create({
      data: {
        status: "CANDIDATE",
        lane,
        actor: "AGENT",
        parentId: active.id,
        files: candidateFiles as unknown as Prisma.InputJsonValue,
        fileShas: fileShas as unknown as Prisma.InputJsonValue,
        limits: candidateLimits as unknown as Prisma.InputJsonValue,
        changeSummary: input.changeSummary,
        changedPaths: changedPaths as unknown as Prisma.InputJsonValue,
        // Nothing before this instant can be claimed as this candidate's evidence.
        evidenceCutoff: now,
        reasoningPattern: input.reasoningPattern,
        successMetric: input.successMetric,
        counterCase: input.counterCase,
        direction,
        scope,
      },
      select: { id: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        reason: "candidate_slot_occupied",
        details: { lane, message: `a ${lane} candidate is already under test` },
      };
    }
    throw err;
  }

  // The challenger must start from a clean book: inheriting the previous candidate's (or
  // the superseded revert series') positions or high-water mark would attribute someone
  // else's P&L to this ruleset. resetBranch also stamps `resetAt`, which is the lower bound
  // evaluate pairs from — so sessions traded by a predecessor can never be counted here.
  await ensureShadowBranches();
  await resetBranch("CANDIDATE", created.id);

  await appendEvolutionEvent({
    kind: "PROPOSE",
    ruleVersionId: created.id,
    actor: "AGENT",
    detail: {
      parentId: active.id,
      lane,
      laneClaimIgnored,
      direction,
      scope,
      changedPaths,
      proseLinesChanged,
      addedLines: added,
      removedLines: removed,
      changeSummary: input.changeSummary,
      reasoningPattern: input.reasoningPattern,
      successMetric: input.successMetric,
      counterCase: input.counterCase,
      worstCase: input.worstCase ?? null,
      evidenceDecisionIds: input.evidenceDecisionIds ?? [],
      evidenceStats: eligibility.stats,
    } as Prisma.InputJsonValue,
  });

  return {
    ok: true,
    ruleVersionId: created.id,
    lane,
    direction,
    scope,
    changedPaths,
    proseLinesChanged,
    laneClaimIgnored,
  };
}

function safeResolve(limits: LimitsConfig, path: string, fallback: LimitsConfig): number {
  try {
    return resolvePointer(limits, path);
  } catch {
    return resolvePointer(fallback, path);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

/** Load the cited evidence (one query per table, joined in memory) and run the pure bar. */
async function runEligibility(
  input: ProposeRuleChangeInput,
  changedPaths: string[],
  now: Date,
  loosens: boolean,
) {
  const ids = [...new Set(input.evidenceDecisionIds ?? [])];
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

  const [reviews, credits, retiredRows, retiredPatterns] = await Promise.all([
    ids.length
      ? prisma.decisionReview.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            ticker: true,
            decisionDate: true,
            createdAt: true,
            decisionType: true,
            finalVerdict: true,
            signalQuality: true,
          },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.counterfactual.findMany({
          where: { decisionReviewId: { in: ids }, status: "RESOLVED" },
          select: { decisionReviewId: true, credit: true },
        })
      : Promise.resolve([]),
    prisma.ruleVersion.findMany({
      where: { status: { in: ["RETIRED", "KILLED"] }, retiredAt: { gte: ninetyDaysAgo } },
      select: { id: true, changedPaths: true, retiredAt: true, reasoningPattern: true },
    }),
    retiredReasoningPatterns(),
  ]);

  const creditByReview = new Map<string, number | null>();
  for (const c of credits) {
    if (!creditByReview.has(c.decisionReviewId)) {
      creditByReview.set(c.decisionReviewId, decToNum(c.credit));
    }
  }

  const rows: EligibilityDecisionRow[] = reviews.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    decisionAt: r.decisionDate ?? r.createdAt,
    decisionType: r.decisionType,
    finalVerdict: r.finalVerdict,
    signalQuality: r.signalQuality,
    counterfactualCredit: creditByReview.get(r.id) ?? null,
  }));

  const recentlyRetired: RetiredVersionRow[] = retiredRows.map((v) => ({
    id: v.id,
    changedPaths: Array.isArray(v.changedPaths)
      ? (v.changedPaths as unknown[]).filter((p): p is string => typeof p === "string")
      : [],
    retiredAt: v.retiredAt,
    reasoningPattern: v.reasoningPattern,
  }));

  return checkEligibility({
    now,
    rows,
    counterCase: input.counterCase,
    successMetric: input.successMetric,
    reasoningPattern: input.reasoningPattern,
    loosens,
    worstCase: input.worstCase ?? null,
    changedPaths,
    recentlyRetired,
    retiredPatterns,
  });
}

/** Re-export so callers building UI can render the whitelist without a second import. */
export { FAST_LANE_PARAMS };
