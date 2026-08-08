/**
 * Dependency-free line diff primitives for rule-version review.
 *
 * Used later by the propose tool to enforce change budgets and to build
 * `changedPaths` entries like `prompts:_shared#7`. This module only computes —
 * budget enforcement lives with the propose tool.
 */

export type LineDiff = {
  added: number;
  removed: number;
  /** 1-based line numbers touched on each side. */
  changedLineNumbers: { a: number[]; b: number[] };
};

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/**
 * Classic LCS line diff (O(n*m) table — prompt files are ~600 lines, fine).
 * Lines present only in `a` count as removed, only in `b` as added.
 */
export function diffLines(a: string, b: string): LineDiff {
  const A = splitLines(a);
  const B = splitLines(b);
  const n = A.length;
  const m = B.length;

  // lcs[i][j] = LCS length of A[i..] and B[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const removedLines: number[] = [];
  const addedLines: number[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      removedLines.push(i + 1);
      i += 1;
    } else {
      addedLines.push(j + 1);
      j += 1;
    }
  }
  while (i < n) {
    removedLines.push(i + 1);
    i += 1;
  }
  while (j < m) {
    addedLines.push(j + 1);
    j += 1;
  }

  return {
    added: addedLines.length,
    removed: removedLines.length,
    changedLineNumbers: { a: removedLines, b: addedLines },
  };
}

export type LineRange = { start: number; end: number };

/** Changed lines (per side) falling inside the given fence ranges for one file. */
export function changedLinesInside(
  ranges: readonly LineRange[],
  diff: LineDiff,
): { a: number[]; b: number[] } {
  const inside = (line: number) => ranges.some((r) => line >= r.start && line <= r.end);
  return {
    a: diff.changedLineNumbers.a.filter(inside),
    b: diff.changedLineNumbers.b.filter(inside),
  };
}

const SECTION_RE = /^##\s+(\d+)\./;

/**
 * Nearest preceding `## N.` section number for a 1-based line, or null when the line
 * sits above the first numbered heading.
 */
export function sectionOf(file: string, lineNo: number): string | null {
  const lines = splitLines(file);
  const limit = Math.min(lineNo, lines.length);
  for (let i = limit - 1; i >= 0; i -= 1) {
    const m = SECTION_RE.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}
