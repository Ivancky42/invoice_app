/**
 * `## N.` section primitives shared by propose, gap-fix, and list_rule_sections.
 * Pure text helpers — no DB. Body text never leaves the caller; inventory returns digests.
 */
import { RULE_FILE_NAMES, sha256Hex } from "@/lib/rules/resolve";

const SECTION_HEADING_RE = /^##\s+(\d+[a-z]?)\./;

export type SectionSlice = {
  sectionId: string;
  /** 0-based line index of the heading. */
  start: number;
  /** 0-based exclusive end (line index of the next heading, or EOF). */
  end: number;
  text: string;
};

export type SectionMeta = {
  sectionId: string;
  /** First line of the section (the `## N. …` heading). */
  heading: string;
  /** sha256 of the exact section text `propose_rule_change` / `apply_gap_fix` pin against. */
  sha256: string;
  lineCount: number;
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

/** Inventory every `## N.` section in a file — metadata only, no body text. */
export function inventorySections(fileText: string): SectionMeta[] {
  const out: SectionMeta[] = [];
  for (const sectionId of sectionIds(fileText)) {
    const slice = findSection(fileText, sectionId);
    if (!slice) continue;
    const lines = splitLines(slice.text);
    out.push({
      sectionId,
      heading: lines[0] ?? `## ${sectionId}.`,
      sha256: sha256Hex(slice.text),
      lineCount: lines.length,
    });
  }
  return out;
}
