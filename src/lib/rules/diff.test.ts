import { describe, expect, it } from "vitest";
import { changedLinesInside, diffLines, sectionOf } from "@/lib/rules/diff";

describe("diffLines", () => {
  it("reports no change for identical text", () => {
    const text = "a\nb\nc";
    expect(diffLines(text, text)).toEqual({
      added: 0,
      removed: 0,
      changedLineNumbers: { a: [], b: [] },
    });
  });

  it("counts a pure insertion", () => {
    const diff = diffLines("a\nb\nc", "a\nx\nb\nc");
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
    expect(diff.changedLineNumbers.b).toEqual([2]);
  });

  it("counts a pure deletion", () => {
    const diff = diffLines("a\nb\nc", "a\nc");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(1);
    expect(diff.changedLineNumbers.a).toEqual([2]);
  });

  it("counts a replacement as one add and one remove", () => {
    const diff = diffLines("a\nb\nc", "a\nB\nc");
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.changedLineNumbers.a).toEqual([2]);
    expect(diff.changedLineNumbers.b).toEqual([2]);
  });

  it("handles an empty original", () => {
    const diff = diffLines("", "a\nb");
    expect(diff.added).toBe(2);
    expect(diff.changedLineNumbers.b).toEqual([1, 2]);
  });

  it("uses the longest common subsequence rather than positional compare", () => {
    const diff = diffLines("a\nb\nc\nd", "a\nc\nd");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(1);
    expect(diff.changedLineNumbers.a).toEqual([2]);
  });
});

describe("changedLinesInside", () => {
  it("keeps only changed lines within the given ranges", () => {
    const diff = diffLines("a\nb\nc\nd\ne", "a\nB\nc\nd\nE");
    const inside = changedLinesInside([{ start: 1, end: 3 }], diff);
    expect(inside.a).toEqual([2]);
    expect(inside.b).toEqual([2]);
  });

  it("returns empty when no change falls inside a fence", () => {
    const diff = diffLines("a\nb", "a\nB");
    expect(changedLinesInside([{ start: 5, end: 9 }], diff)).toEqual({ a: [], b: [] });
  });
});

describe("sectionOf", () => {
  const doc = ["intro", "## 1. First", "body", "## 2. Second", "more", "### 2.1 sub", "tail"].join(
    "\n",
  );

  it("returns null above the first numbered heading", () => {
    expect(sectionOf(doc, 1)).toBeNull();
  });

  it("returns the heading's own number", () => {
    expect(sectionOf(doc, 2)).toBe("1");
  });

  it("returns the nearest preceding numbered section", () => {
    expect(sectionOf(doc, 3)).toBe("1");
    expect(sectionOf(doc, 5)).toBe("2");
    expect(sectionOf(doc, 7)).toBe("2");
  });

  it("ignores non `## N.` headings", () => {
    expect(sectionOf(doc, 6)).toBe("2");
  });
});
