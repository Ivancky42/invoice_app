import { describe, expect, it } from "vitest";
import {
  assignLane,
  findSection,
  normaliseRuleFile,
  replaceSection,
  sectionIds,
} from "@/lib/evolution/propose";

const FILE = [
  "# Shared",
  "",
  "## 1. First",
  "alpha",
  "",
  "## 2. Second",
  "beta",
  "gamma",
  "",
  "## 3. Third",
  "delta",
].join("\n");

describe("assignLane", () => {
  it("FAST when only whitelisted numbers moved", () => {
    expect(
      assignLane({ proseLinesChanged: 0, limitsPaths: ["/singlePositionPct"] }),
    ).toEqual({ lane: "FAST", laneClaimIgnored: null });
  });

  it("SLOW as soon as one prose line moved, even with whitelisted params", () => {
    expect(
      assignLane({ proseLinesChanged: 1, limitsPaths: ["/singlePositionPct"] }).lane,
    ).toBe("SLOW");
  });

  it("SLOW when any changed path is off the whitelist", () => {
    expect(
      assignLane({
        proseLinesChanged: 0,
        limitsPaths: ["/singlePositionPct", "/entryZoneWidthPct"],
      }).lane,
    ).toBe("SLOW");
  });

  it("mixed FAST + SLOW registry paths take the SLOW lane", () => {
    // /tierBands/CONVICTION/1 is FAST, /tierBands/CONVICTION/0 is SLOW: one SLOW rail in
    // the set drags the whole proposal onto the long evidence horizon.
    expect(
      assignLane({
        proseLinesChanged: 0,
        limitsPaths: ["/tierBands/CONVICTION/1", "/tierBands/CONVICTION/0"],
      }).lane,
    ).toBe("SLOW");
    expect(
      assignLane({ proseLinesChanged: 0, limitsPaths: ["/tierBands/CONVICTION/1"] }).lane,
    ).toBe("FAST");
  });

  it("SLOW when nothing changed at all", () => {
    expect(assignLane({ proseLinesChanged: 0, limitsPaths: [] }).lane).toBe("SLOW");
  });

  it("records a lane claim but never honours it", () => {
    const claimed = assignLane({
      proseLinesChanged: 40,
      limitsPaths: [],
      laneClaim: "FAST",
    });
    expect(claimed).toEqual({ lane: "SLOW", laneClaimIgnored: "FAST" });
  });

  it("a lane claim that happens to agree is still only recorded", () => {
    expect(
      assignLane({ proseLinesChanged: 0, limitsPaths: ["/cashFloorPct"], laneClaim: "FAST" }),
    ).toEqual({ lane: "FAST", laneClaimIgnored: "FAST" });
  });

  it("ignores empty / non-string lane claims", () => {
    expect(assignLane({ proseLinesChanged: 0, limitsPaths: [], laneClaim: "  " }).laneClaimIgnored)
      .toBeNull();
    expect(assignLane({ proseLinesChanged: 0, limitsPaths: [], laneClaim: 3 }).laneClaimIgnored)
      .toBeNull();
  });
});

describe("section primitives", () => {
  it("finds a middle section and stops at the next heading", () => {
    const slice = findSection(FILE, "2");
    expect(slice?.text).toBe("## 2. Second\nbeta\ngamma\n");
  });

  it("finds the last section through EOF", () => {
    expect(findSection(FILE, "3")?.text).toBe("## 3. Third\ndelta");
  });

  it("returns null for a missing section", () => {
    expect(findSection(FILE, "9")).toBeNull();
  });

  it("replaces only the named section", () => {
    const next = replaceSection(FILE, "2", "## 2. Second\nrewritten");
    expect(next).toContain("## 1. First\nalpha");
    expect(next).toContain("## 2. Second\nrewritten");
    expect(next).toContain("## 3. Third\ndelta");
    expect(next).not.toContain("beta");
  });

  it("replace on a missing section is null, not a silent append", () => {
    expect(replaceSection(FILE, "9", "x")).toBeNull();
  });

  it("lists section ids in order", () => {
    expect(sectionIds(FILE)).toEqual(["1", "2", "3"]);
  });

  it("detects a deleted heading via sectionIds", () => {
    const next = replaceSection(FILE, "2", "just prose, no heading")!;
    expect(sectionIds(next)).toEqual(["1", "3"]);
  });
});

describe("normaliseRuleFile", () => {
  it("accepts the five prompt files with or without .md", () => {
    expect(normaliseRuleFile("_shared")).toBe("_shared.md");
    expect(normaliseRuleFile("daily.md")).toBe("daily.md");
    expect(normaliseRuleFile(" weekly ")).toBe("weekly.md");
  });

  it("rejects anything else", () => {
    expect(normaliseRuleFile("kernelClauses")).toBeNull();
    expect(normaliseRuleFile("../../etc/passwd")).toBeNull();
  });
});
