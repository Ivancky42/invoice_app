import { describe, expect, it } from "vitest";
import { rebaseDecision } from "@/lib/evolution/gapfix";

describe("rebaseDecision", () => {
  it("rebases when the gap-fix touched a section the candidate did not", () => {
    expect(rebaseDecision(["prompts:_shared#7"], ["prompts:_shared#14"])).toBe("rebase");
  });

  it("conflicts when both edited the same section of the same file", () => {
    expect(rebaseDecision(["prompts:_shared#7"], ["prompts:_shared#7"])).toBe("conflict");
  });

  it("does not conflict across files with the same section number", () => {
    expect(rebaseDecision(["prompts:daily#7"], ["prompts:_shared#7"])).toBe("rebase");
  });

  it("a limits-only candidate always rebases", () => {
    expect(rebaseDecision(["limits:/singlePositionPct"], ["prompts:_shared#7"])).toBe("rebase");
  });

  it("a candidate with no changed paths rebases", () => {
    expect(rebaseDecision([], ["prompts:_shared#7"])).toBe("rebase");
  });

  it("conflicts on ANY intersection, not only a total one", () => {
    expect(
      rebaseDecision(
        ["limits:/cashFloorPct", "prompts:daily#2", "prompts:_shared#7"],
        ["prompts:_shared#7"],
      ),
    ).toBe("conflict");
  });
});
