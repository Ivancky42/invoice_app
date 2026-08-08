/**
 * Kernel enforcement primitives.
 *
 * The kernel is the set of fenced prompt regions (`<!-- KERNEL:BEGIN id=… -->` …
 * `<!-- KERNEL:END id=… -->`) whose text is pinned by a checked-in sha256 constant
 * (`KERNEL_CLAUSES`). A candidate ruleset that moves, duplicates, drops, or edits a
 * single character inside a fence is invalid — changing the kernel requires a human
 * commit + deploy, never a DB write.
 */
import { createHash } from "node:crypto";
import { KERNEL_CLAUSES } from "@/lib/rules/kernelClauses";

const BEGIN_RE = /^<!--\s*KERNEL:BEGIN\s+id=([A-Za-z0-9._-]+)(?:\s+v=(\d+))?\s*-->\s*$/;
const END_RE = /^<!--\s*KERNEL:END\s+id=([A-Za-z0-9._-]+)\s*-->\s*$/;
/** Any line mentioning the marker token — used to catch malformed/partial markers. */
const MARKERISH_RE = /KERNEL:(BEGIN|END)/;

export type KernelViolationCode =
  | "MISSING_REGION"
  | "DUPLICATE_REGION"
  | "TEXT_MODIFIED"
  | "MARKER_TAMPERED";

export type KernelViolation = {
  code: KernelViolationCode;
  clauseId: string;
  file?: string;
  line?: number;
};

export type KernelRegion = {
  clauseId: string;
  file: string;
  /** 1-based line of the BEGIN marker. */
  beginLine: number;
  /** 1-based line of the END marker. */
  endLine: number;
  /** Raw text between the markers (exclusive), pre-canonicalisation. */
  text: string;
};

/** Line ranges (1-based, marker lines included) covered by kernel fences, per file. */
export type FenceRanges = Record<string, Array<{ start: number; end: number }>>;

/**
 * Canonical form used for hashing: CRLF→LF, trailing whitespace stripped per line,
 * runs of blank lines collapsed to one, outer whitespace trimmed.
 */
export function canonicaliseRegion(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === "" && collapsed.length > 0 && collapsed[collapsed.length - 1] === "") continue;
    collapsed.push(line);
  }
  return collapsed.join("\n").trim();
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

type ExtractResult = {
  regions: KernelRegion[];
  tampered: Array<{ clauseId: string; file: string; line: number }>;
};

/**
 * Extract every well-formed kernel region. Unpaired / nested / mismatched / malformed
 * markers are reported as tampering rather than silently skipped.
 */
export function extractRegions(files: Record<string, string>): ExtractResult {
  const regions: KernelRegion[] = [];
  const tampered: Array<{ clauseId: string; file: string; line: number }> = [];

  for (const file of Object.keys(files).sort()) {
    const lines = (files[file] ?? "").replace(/\r\n?/g, "\n").split("\n");
    let open: { clauseId: string; line: number; body: string[] } | null = null;

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const lineNo = i + 1;
      const begin = BEGIN_RE.exec(raw.trim());
      const end = END_RE.exec(raw.trim());

      if (begin) {
        if (open) {
          // Nested BEGIN — the outer region can never be closed correctly.
          tampered.push({ clauseId: open.clauseId, file, line: lineNo });
          open = null;
          continue;
        }
        open = { clauseId: begin[1], line: lineNo, body: [] };
        continue;
      }

      if (end) {
        if (!open) {
          tampered.push({ clauseId: end[1], file, line: lineNo });
          continue;
        }
        if (open.clauseId !== end[1]) {
          tampered.push({ clauseId: open.clauseId, file, line: open.line });
          open = null;
          continue;
        }
        regions.push({
          clauseId: open.clauseId,
          file,
          beginLine: open.line,
          endLine: lineNo,
          text: open.body.join("\n"),
        });
        open = null;
        continue;
      }

      if (MARKERISH_RE.test(raw)) {
        // Marker token present but the line is not a valid marker.
        tampered.push({ clauseId: open?.clauseId ?? "unknown", file, line: lineNo });
        continue;
      }

      if (open) open.body.push(raw);
    }

    if (open) tampered.push({ clauseId: open.clauseId, file, line: open.line });
  }

  return { regions, tampered };
}

/** Fence line ranges per file (markers inclusive) — for diff/budget helpers. */
export function fenceRanges(files: Record<string, string>): FenceRanges {
  const out: FenceRanges = {};
  for (const region of extractRegions(files).regions) {
    (out[region.file] ??= []).push({ start: region.beginLine, end: region.endLine });
  }
  return out;
}

/**
 * Validate a candidate ruleset against the checked-in kernel hashes.
 * Empty array = kernel intact.
 */
export function validateKernel(files: Record<string, string>): KernelViolation[] {
  const violations: KernelViolation[] = [];
  const { regions, tampered } = extractRegions(files);

  for (const t of tampered) {
    violations.push({ code: "MARKER_TAMPERED", clauseId: t.clauseId, file: t.file, line: t.line });
  }

  const known = new Set(KERNEL_CLAUSES.map((c) => c.id));
  for (const region of regions) {
    if (known.has(region.clauseId)) continue;
    // A fence with an id we do not pin would let prose hide from the forbidden-pattern scan.
    violations.push({
      code: "MARKER_TAMPERED",
      clauseId: region.clauseId,
      file: region.file,
      line: region.beginLine,
    });
  }

  for (const clause of KERNEL_CLAUSES) {
    const found = regions.filter((r) => r.clauseId === clause.id);
    if (found.length === 0) {
      violations.push({ code: "MISSING_REGION", clauseId: clause.id });
      continue;
    }
    if (found.length > 1) {
      for (const dup of found.slice(1)) {
        violations.push({
          code: "DUPLICATE_REGION",
          clauseId: clause.id,
          file: dup.file,
          line: dup.beginLine,
        });
      }
    }
    const region = found[0];
    if (sha256Hex(canonicaliseRegion(region.text)) !== clause.sha256) {
      violations.push({
        code: "TEXT_MODIFIED",
        clauseId: clause.id,
        file: region.file,
        line: region.beginLine,
      });
    }
  }

  return violations;
}

export type ForbiddenPattern = {
  /** Stable id for logging / tests. */
  id: string;
  regex: RegExp;
};

/**
 * Prose outside the kernel fences that would neutralise the kernel by other means.
 * Deterministic regexes only — this is a hard gate, not a judgement call.
 */
export const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  // Instructs actually placing/executing/routing a real order.
  {
    id: "place-real-order",
    regex:
      /\b(place|submit|route|send|execute|fill)\b[^.\n]{0,40}\b(a\s+)?(real|live|market|limit|stop)?\s*(order|trade)\b/i,
  },
  // Instructs contacting a broker / execution venue directly.
  { id: "broker-execution", regex: /\b(broker|brokerage|trading api|execution venue)\b[^.\n]{0,40}\b(connect|call|place|execute|route)\b/i },
  // Declares §5 or §3 suspended / inapplicable / overridden.
  { id: "section-no-longer-applies", regex: /§\s*(3|5)\b[^.\n]{0,60}\b(no longer|does not|doesn't|need not|needn't|shall not)\s+appl(?:y|ies)/i },
  { id: "section-suspended", regex: /\b(suspend|waive|override|ignore|disregard|bypass)\w*\b[^.\n]{0,40}§\s*(3|5)\b/i },
  { id: "section-superseded", regex: /§\s*(3|5)\b[^.\n]{0,40}\bis\s+(hereby\s+)?(suspended|waived|void|revoked|overridden|optional)\b/i },
  // Targets the execution boundary / price provenance kernel clauses by name.
  { id: "kernel-clause-disabled", regex: /\b(execution boundary|price provenance)\b[^.\n]{0,40}\b(no longer|does not|doesn't)\s+appl(?:y|ies)|\b(execution boundary|price provenance)\b[^.\n]{0,30}\bis\s+(suspended|waived|optional|void)\b/i },
  // Deletes / edits / rewrites the audit log.
  { id: "audit-mutation", regex: /\b(delete|remove|edit|update|rewrite|purge|redact|truncate|drop)\w*\b[^.\n]{0,40}\bEvolutionEvent\b/i },
  { id: "audit-mutation-reverse", regex: /\bEvolutionEvent\b[^.\n]{0,40}\b(may|can|should|must)\s+be\s+(deleted|removed|edited|updated|rewritten|purged|redacted)\b/i },
  // Fabricates or estimates prices instead of using synced marks.
  { id: "fabricate-price", regex: /\b(estimate|invent|assume|make up|approximate|synthesi[sz]e|fabricate)\w*\b[^.\n]{0,30}\b(price|close|quote|mark)s?\b/i },
  { id: "fabricate-price-reverse", regex: /\b(price|close|quote|mark)s?\b[^.\n]{0,30}\b(may|can)\s+be\s+(estimated|invented|assumed|made up|approximated|fabricated)\b/i },
  // Redefines fitness.
  { id: "redefine-fitness", regex: /\bfitness\b[^.\n]{0,40}\b(is\s+redefined|redefine[sd]?|shall\s+mean|now\s+means|is\s+now)\b/i },
  { id: "drop-fitness-component", regex: /\b(drop|ignore|exclude|omit|zero out|clamp)\w*\b[^.\n]{0,30}\b(drawdown penalty|turnover cost|benchmark return|avoided[- ]loss credit)\b/i },
];

export type ForbiddenHit = { pattern: string; file: string; line: number };

/**
 * Scan prose OUTSIDE kernel fences for forbidden instructions.
 * Fenced text is exempt — it is hash-pinned and legitimately talks about not trading.
 */
export function scanForbiddenPatterns(files: Record<string, string>): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  const ranges = fenceRanges(files);

  for (const file of Object.keys(files).sort()) {
    const inFence = ranges[file] ?? [];
    const lines = (files[file] ?? "").replace(/\r\n?/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const lineNo = i + 1;
      if (inFence.some((r) => lineNo >= r.start && lineNo <= r.end)) continue;
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.regex.test(lines[i])) {
          hits.push({ pattern: pattern.id, file, line: lineNo });
        }
      }
    }
  }

  return hits;
}
